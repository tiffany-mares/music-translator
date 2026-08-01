// Package push implements architecture.md §5.6's job-status push handler,
// driven by DynamoDB Streams on LyraLearnTable. Three documented deviations
// from the §5.6 reference (notes/phase6.md §6.2):
//   - the reference reads userId off the job item's stream image, but the
//     real schema puts NO userId on JOB# items — the owner lives only on
//     SONG#{songId}/METADATA.uploadedBy, so we GetItem that;
//   - the reference posts to a single looked-up connectionId; we fan out to
//     ALL of the user's connections via GSI1 (multi-tab);
//   - Handle ALWAYS returns nil. A returned error makes Streams re-drive the
//     whole batch, duplicating pushes to healthy connections. At-most-once is
//     correct for status pushes — 4.2's polling remains the tested fallback.
//
// The message mirrors GET /jobs/{id} (lambda/api handler.get_job) byte-for-
// byte in field names and semantics so 6.3 reuses the existing Job type.
package push

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"strings"

	"github.com/aws/aws-lambda-go/events"
)

// ErrGone marks a stale connectionId (API Gateway 410). APIPoster maps the
// management API's types.GoneException onto it so handler logic — and its
// tests — never touch the SDK.
var ErrGone = errors.New("connection gone")

// MetadataReader resolves a song's owner. Returns "" (no error) when the
// METADATA item or its uploadedBy attribute is missing.
type MetadataReader interface {
	UploadedBy(ctx context.Context, songID string) (string, error)
}

// ConnectionLister is satisfied by *store.DynamoStore.
type ConnectionLister interface {
	ConnectionsByUser(ctx context.Context, userID string) ([]string, error)
}

// ConnectionDeleter is satisfied by *store.DynamoStore (GoneException cleanup
// reuses the same Delete the $disconnect handler uses).
type ConnectionDeleter interface {
	Delete(ctx context.Context, connectionID string) error
}

// Poster sends one frame to one connection; returns ErrGone for stale rows.
type Poster interface {
	Post(ctx context.Context, connectionID string, data []byte) error
}

type Handler struct {
	Metadata    MetadataReader
	Connections ConnectionLister
	Poster      Poster
	Cleanup     ConnectionDeleter
}

// message is the polling contract: {jobId, songId, status, stage?,
// chunkCount?, error?}. chunkCount is ≥1 whenever the pipeline writes it, so
// omitempty on int64 is safe; error carries errorInfo capped at 500 runes —
// the same cap get_job applies.
type message struct {
	JobID      string `json:"jobId"`
	SongID     string `json:"songId"`
	Status     string `json:"status"`
	Stage      string `json:"stage,omitempty"`
	ChunkCount int64  `json:"chunkCount,omitempty"`
	Error      string `json:"error,omitempty"`
}

// jobKeys extracts songId/jobKey from the record keys; ok=false for non-job
// items — belt and braces behind the event source mapping's FilterCriteria.
func jobKeys(keys map[string]events.DynamoDBAttributeValue) (songID, jobKey string, ok bool) {
	pk, okPK := keys["PK"]
	sk, okSK := keys["SK"]
	if !okPK || !okSK ||
		pk.DataType() != events.DataTypeString || sk.DataType() != events.DataTypeString ||
		!strings.HasPrefix(pk.String(), "SONG#") || !strings.HasPrefix(sk.String(), "JOB#") {
		return "", "", false
	}
	return strings.TrimPrefix(pk.String(), "SONG#"), strings.TrimPrefix(sk.String(), "JOB#"), true
}

func truncateRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}

// buildMessage is pure: stream image in, wire bytes out.
func buildMessage(songID, jobKey string, img map[string]events.DynamoDBAttributeValue) []byte {
	m := message{JobID: songID + "." + jobKey, SongID: songID, Status: img["status"].String()}
	if v, present := img["stage"]; present && v.DataType() == events.DataTypeString {
		m.Stage = v.String()
	}
	if v, present := img["chunkCount"]; present && v.DataType() == events.DataTypeNumber {
		if n, err := v.Integer(); err == nil {
			m.ChunkCount = n
		} else {
			log.Printf("job %s.%s: unparseable chunkCount %q: %v", songID, jobKey, v.Number(), err)
		}
	}
	if v, present := img["errorInfo"]; present && v.DataType() == events.DataTypeString {
		m.Error = truncateRunes(v.String(), 500)
	}
	b, _ := json.Marshal(m) // struct of strings/int64 cannot fail to marshal
	return b
}

// Handle processes a Streams batch. Every failure mode logs and moves on;
// see the package comment for why it never returns an error.
func (h *Handler) Handle(ctx context.Context, ev events.DynamoDBEvent) error {
	for _, rec := range ev.Records {
		h.handleRecord(ctx, rec)
	}
	return nil
}

func (h *Handler) handleRecord(ctx context.Context, rec events.DynamoDBEventRecord) {
	if rec.EventName != "MODIFY" {
		return
	}
	songID, jobKey, ok := jobKeys(rec.Change.Keys)
	if !ok {
		return
	}
	img := rec.Change.NewImage
	if st, present := img["status"]; !present || st.DataType() != events.DataTypeString {
		log.Printf("job %s.%s: stream image has no status - skipping", songID, jobKey)
		return
	}
	msg := buildMessage(songID, jobKey, img)

	userID, err := h.Metadata.UploadedBy(ctx, songID)
	if err != nil {
		log.Printf("job %s.%s: metadata read failed: %v - skipping (polling covers)", songID, jobKey, err)
		return
	}
	if userID == "" {
		log.Printf("job %s.%s: no METADATA/uploadedBy - skipping", songID, jobKey)
		return
	}
	conns, err := h.Connections.ConnectionsByUser(ctx, userID)
	if err != nil {
		log.Printf("job %s.%s: connection lookup failed: %v - skipping", songID, jobKey, err)
		return
	}
	for _, cid := range conns {
		err := h.Poster.Post(ctx, cid, msg)
		switch {
		case err == nil:
		case errors.Is(err, ErrGone):
			// Stale row from an unclean disconnect (6.1's accepted leak
			// class) - best-effort cleanup, keep fanning out.
			if derr := h.Cleanup.Delete(ctx, cid); derr != nil {
				log.Printf("stale connection %s: delete failed: %v", cid, derr)
			} else {
				log.Printf("stale connection %s: cleaned up (410)", cid)
			}
		default:
			log.Printf("post to %s failed: %v - continuing", cid, err)
		}
	}
}
