package push

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/aws/aws-lambda-go/events"
)

// ---- fakes ----

type fakeMetadata struct {
	user  string
	err   error
	calls []string
}

func (f *fakeMetadata) UploadedBy(_ context.Context, songID string) (string, error) {
	f.calls = append(f.calls, songID)
	return f.user, f.err
}

type fakeLister struct {
	conns []string
	err   error
	calls int
}

func (f *fakeLister) ConnectionsByUser(_ context.Context, _ string) ([]string, error) {
	f.calls++
	return f.conns, f.err
}

type post struct {
	conn string
	data string
}

type fakePoster struct {
	posts []post
	errs  map[string]error // per-connection error
}

func (f *fakePoster) Post(_ context.Context, conn string, data []byte) error {
	f.posts = append(f.posts, post{conn: conn, data: string(data)})
	return f.errs[conn]
}

type fakeDeleter struct {
	deleted []string
	err     error
}

func (f *fakeDeleter) Delete(_ context.Context, conn string) error {
	f.deleted = append(f.deleted, conn)
	return f.err
}

// ---- helpers ----

func handler(m *fakeMetadata, l *fakeLister, p *fakePoster, d *fakeDeleter) *Handler {
	return &Handler{Metadata: m, Connections: l, Poster: p, Cleanup: d}
}

func jobRecord(eventName, pk, sk string, img map[string]events.DynamoDBAttributeValue) events.DynamoDBEventRecord {
	rec := events.DynamoDBEventRecord{EventName: eventName}
	rec.Change.Keys = map[string]events.DynamoDBAttributeValue{
		"PK": events.NewStringAttribute(pk),
		"SK": events.NewStringAttribute(sk),
	}
	rec.Change.NewImage = img
	return rec
}

func ev(recs ...events.DynamoDBEventRecord) events.DynamoDBEvent {
	return events.DynamoDBEvent{Records: recs}
}

func processingImage() map[string]events.DynamoDBAttributeValue {
	return map[string]events.DynamoDBAttributeValue{
		"status": events.NewStringAttribute("PROCESSING"),
		"stage":  events.NewStringAttribute("ChunkAudio"),
	}
}

func errWrap(prefix string, err error) error {
	return fmt.Errorf("%s: %w", prefix, err)
}

// ---- filtering (belt and braces behind the ESM FilterCriteria) ----

func TestInsertSkippedNoLookupsNoPosts(t *testing.T) {
	m, l, p, d := &fakeMetadata{user: "sub-1"}, &fakeLister{conns: []string{"c1"}}, &fakePoster{}, &fakeDeleter{}
	img := map[string]events.DynamoDBAttributeValue{"status": events.NewStringAttribute("QUEUED")}
	if err := handler(m, l, p, d).Handle(context.Background(), ev(jobRecord("INSERT", "SONG#s1", "JOB#j1", img))); err != nil {
		t.Fatal(err)
	}
	if len(m.calls) != 0 || len(p.posts) != 0 {
		t.Fatalf("INSERT reached metadata (%d) or poster (%d)", len(m.calls), len(p.posts))
	}
}

func TestNonJobSKSkipped(t *testing.T) {
	m, l, p, d := &fakeMetadata{user: "sub-1"}, &fakeLister{conns: []string{"c1"}}, &fakePoster{}, &fakeDeleter{}
	img := map[string]events.DynamoDBAttributeValue{"status": events.NewStringAttribute("whatever")}
	e := ev(
		jobRecord("MODIFY", "SONG#s1", "METADATA", img),
		jobRecord("MODIFY", "USER#u1", "VOCAB#hello", img),
	)
	if err := handler(m, l, p, d).Handle(context.Background(), e); err != nil {
		t.Fatal(err)
	}
	if len(m.calls) != 0 || len(p.posts) != 0 {
		t.Fatalf("non-job records reached metadata (%d) or poster (%d)", len(m.calls), len(p.posts))
	}
}

func TestMissingStatusSkipped(t *testing.T) {
	m, l, p, d := &fakeMetadata{user: "sub-1"}, &fakeLister{conns: []string{"c1"}}, &fakePoster{}, &fakeDeleter{}
	img := map[string]events.DynamoDBAttributeValue{"stage": events.NewStringAttribute("ChunkAudio")}
	if err := handler(m, l, p, d).Handle(context.Background(), ev(jobRecord("MODIFY", "SONG#s1", "JOB#j1", img))); err != nil {
		t.Fatal(err)
	}
	if len(m.calls) != 0 || len(p.posts) != 0 {
		t.Fatal("statusless image should be skipped before any lookup")
	}
}

// ---- message shape: the polling contract, byte for byte ----

func TestProcessingMessageShape(t *testing.T) {
	m, l, p, d := &fakeMetadata{user: "sub-1"}, &fakeLister{conns: []string{"c1"}}, &fakePoster{}, &fakeDeleter{}
	if err := handler(m, l, p, d).Handle(context.Background(), ev(jobRecord("MODIFY", "SONG#song-1", "JOB#abc123", processingImage()))); err != nil {
		t.Fatal(err)
	}
	want := `{"jobId":"song-1.abc123","songId":"song-1","status":"PROCESSING","stage":"ChunkAudio"}`
	if len(p.posts) != 1 || p.posts[0].data != want {
		t.Fatalf("posted %v, want [%s]", p.posts, want)
	}
}

func TestCompleteMessageChunkCountIsJSONNumber(t *testing.T) {
	m, l, p, d := &fakeMetadata{user: "sub-1"}, &fakeLister{conns: []string{"c1"}}, &fakePoster{}, &fakeDeleter{}
	img := map[string]events.DynamoDBAttributeValue{
		"status":     events.NewStringAttribute("COMPLETE"),
		"chunkCount": events.NewNumberAttribute("6"), // N arrives as a string in the image
		"stageOutputs": events.NewMapAttribute(map[string]events.DynamoDBAttributeValue{
			"lyrics": events.NewStringAttribute("s3://x"), // present on the real item, must NOT leak
		}),
	}
	if err := handler(m, l, p, d).Handle(context.Background(), ev(jobRecord("MODIFY", "SONG#song-1", "JOB#abc123", img))); err != nil {
		t.Fatal(err)
	}
	want := `{"jobId":"song-1.abc123","songId":"song-1","status":"COMPLETE","chunkCount":6}`
	if len(p.posts) != 1 || p.posts[0].data != want {
		t.Fatalf("posted %v, want [%s]", p.posts, want)
	}
}

func TestFailedMessageTruncatesErrorAt500Runes(t *testing.T) {
	m, l, p, d := &fakeMetadata{user: "sub-1"}, &fakeLister{conns: []string{"c1"}}, &fakePoster{}, &fakeDeleter{}
	long := strings.Repeat("ă", 600) // multi-byte: proves rune (not byte) parity with Python's [:500]
	img := map[string]events.DynamoDBAttributeValue{
		"status":    events.NewStringAttribute("FAILED"),
		"errorInfo": events.NewStringAttribute(long),
	}
	if err := handler(m, l, p, d).Handle(context.Background(), ev(jobRecord("MODIFY", "SONG#s1", "JOB#j1", img))); err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal([]byte(p.posts[0].data), &got); err != nil {
		t.Fatal(err)
	}
	e, _ := got["error"].(string)
	if len([]rune(e)) != 500 {
		t.Fatalf("error length = %d runes, want 500", len([]rune(e)))
	}
	if got["status"] != "FAILED" {
		t.Fatalf("status = %v", got["status"])
	}
}

// ---- owner resolution ----

func TestMissingMetadataSkipsWithoutError(t *testing.T) {
	m, l, p, d := &fakeMetadata{user: ""}, &fakeLister{conns: []string{"c1"}}, &fakePoster{}, &fakeDeleter{}
	if err := handler(m, l, p, d).Handle(context.Background(), ev(jobRecord("MODIFY", "SONG#s1", "JOB#j1", processingImage()))); err != nil {
		t.Fatal(err)
	}
	if l.calls != 0 || len(p.posts) != 0 {
		t.Fatal("ownerless job must not fan out")
	}
}

func TestMetadataErrorSkipsAndReturnsNil(t *testing.T) {
	m, l, p, d := &fakeMetadata{err: errors.New("throttled")}, &fakeLister{conns: []string{"c1"}}, &fakePoster{}, &fakeDeleter{}
	if err := handler(m, l, p, d).Handle(context.Background(), ev(jobRecord("MODIFY", "SONG#s1", "JOB#j1", processingImage()))); err != nil {
		t.Fatalf("must swallow (Streams would re-drive the batch), got %v", err)
	}
	if len(p.posts) != 0 {
		t.Fatal("no post expected")
	}
}

func TestListerErrorReturnsNil(t *testing.T) {
	m, l, p, d := &fakeMetadata{user: "sub-1"}, &fakeLister{err: errors.New("boom")}, &fakePoster{}, &fakeDeleter{}
	if err := handler(m, l, p, d).Handle(context.Background(), ev(jobRecord("MODIFY", "SONG#s1", "JOB#j1", processingImage()))); err != nil {
		t.Fatalf("must swallow, got %v", err)
	}
}

// ---- fan-out ----

func TestFanOutToAllConnections(t *testing.T) {
	m, l, p, d := &fakeMetadata{user: "sub-1"}, &fakeLister{conns: []string{"c1", "c2", "c3"}}, &fakePoster{}, &fakeDeleter{}
	if err := handler(m, l, p, d).Handle(context.Background(), ev(jobRecord("MODIFY", "SONG#s1", "JOB#j1", processingImage()))); err != nil {
		t.Fatal(err)
	}
	if len(p.posts) != 3 {
		t.Fatalf("posted %d times, want 3 (multi-tab §5.6 deviation)", len(p.posts))
	}
	for i, want := range []string{"c1", "c2", "c3"} {
		if p.posts[i].conn != want || p.posts[i].data != p.posts[0].data {
			t.Fatalf("post %d = %+v, want conn %s with identical payload", i, p.posts[i], want)
		}
	}
}

func TestGoneConnectionDeletedOthersStillPosted(t *testing.T) {
	m := &fakeMetadata{user: "sub-1"}
	l := &fakeLister{conns: []string{"stale", "live"}}
	p := &fakePoster{errs: map[string]error{"stale": ErrGone}}
	d := &fakeDeleter{}
	if err := handler(m, l, p, d).Handle(context.Background(), ev(jobRecord("MODIFY", "SONG#s1", "JOB#j1", processingImage()))); err != nil {
		t.Fatal(err)
	}
	if len(d.deleted) != 1 || d.deleted[0] != "stale" {
		t.Fatalf("deleted %v, want [stale]", d.deleted)
	}
	if len(p.posts) != 2 || p.posts[1].conn != "live" {
		t.Fatalf("posts %v - live connection must still receive the push", p.posts)
	}
}

func TestWrappedGoneStillTriggersCleanup(t *testing.T) {
	m := &fakeMetadata{user: "sub-1"}
	l := &fakeLister{conns: []string{"stale"}}
	p := &fakePoster{errs: map[string]error{"stale": errWrap("conn-x", ErrGone)}}
	d := &fakeDeleter{}
	if err := handler(m, l, p, d).Handle(context.Background(), ev(jobRecord("MODIFY", "SONG#s1", "JOB#j1", processingImage()))); err != nil {
		t.Fatal(err)
	}
	if len(d.deleted) != 1 {
		t.Fatal("errors.Is must see through the APIPoster wrap")
	}
}

func TestOtherPostErrorNoDeleteContinuesNil(t *testing.T) {
	m := &fakeMetadata{user: "sub-1"}
	l := &fakeLister{conns: []string{"flaky", "live"}}
	p := &fakePoster{errs: map[string]error{"flaky": errors.New("500 from apigw")}}
	d := &fakeDeleter{}
	if err := handler(m, l, p, d).Handle(context.Background(), ev(jobRecord("MODIFY", "SONG#s1", "JOB#j1", processingImage()))); err != nil {
		t.Fatalf("must swallow, got %v", err)
	}
	if len(d.deleted) != 0 {
		t.Fatal("non-Gone error must not delete the row")
	}
	if len(p.posts) != 2 {
		t.Fatal("fan-out must continue past a failed post")
	}
}

func TestDeleteFailureDoesNotAbortFanOut(t *testing.T) {
	m := &fakeMetadata{user: "sub-1"}
	l := &fakeLister{conns: []string{"stale", "live"}}
	p := &fakePoster{errs: map[string]error{"stale": ErrGone}}
	d := &fakeDeleter{err: errors.New("delete boom")}
	if err := handler(m, l, p, d).Handle(context.Background(), ev(jobRecord("MODIFY", "SONG#s1", "JOB#j1", processingImage()))); err != nil {
		t.Fatal(err)
	}
	if len(p.posts) != 2 {
		t.Fatal("fan-out must survive a failed cleanup")
	}
}
