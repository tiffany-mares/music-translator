# LyraLearn — Architecture & Design Doc

## 1. What this doc covers

Technical foundation for LyraLearn: a music-based language learning platform that separates a song into stems, transcribes and translates the lyrics, and extracts melody/pitch data for an interactive, word-synced learning player.

**v4 note — this is the deployment stack.** Fully serverless: Lambda for every backend service, DynamoDB for job state/song metadata/vocab/spaced-repetition, MongoDB Atlas (free tier) for lyrics/translation/timing. No EKS, no RDS, no VPC, no NAT Gateway — nothing here has a fixed monthly cost independent of usage. At Tier A scale (30-50 users, 20-30 songs/month), this runs at roughly **$6-10/month**.

13 technologies are live in this version: AWS, Python, PyTorch, React, JavaScript, TensorFlow, Rust, Go, Java, C++, DynamoDB, MongoDB.

---

## 2. User journey and sequencing

1. `POST /auth/*` — Cognito-backed signup/login, returns JWT
2. `POST /songs` — client requests a pre-signed S3 upload URL
3. Client `PUT`s the audio file directly to S3
4. `POST /songs/{songId}/process` — triggers the Rust Lambda, which validates the upload **and** computes an audio fingerprint in the same pass (Section 5.2a)
5. **If the fingerprint matches an already-processed song**: the Rust Lambda links the new `songId` to the existing lyrics/stems/pitch data directly, skipping Step Functions entirely — the player is ready in well under a second.
6. **If it's a new song**: Step Functions fans the audio out into overlapping chunks and processes them in parallel (Section 4), then stitches the results back together
7. The moment upload validation passes, the client can start **audio playback immediately** — it doesn't wait on the pipeline. Lyrics, translation, and pitch data hydrate into the player progressively as they become available, rather than gating playback on full pipeline completion (Section 5.1)
8. Client subscribes to job status via API Gateway WebSocket API (Go Lambda backing it), with polling `GET /jobs/{jobId}` as fallback
9. During/after playback, vocab events are POSTed to the learning API (Java Lambda), which schedules future reviews in DynamoDB

Latency budget: a cache-hit (step 5) is near-instant — a DynamoDB lookup, not a pipeline run. A genuinely new song's full pipeline (transcription, translation, pitch data — not audio playback, which starts immediately per step 7) now runs in roughly **70-110 seconds**, down from the original 8-13 minute worst case and the previously-revised 2-3 minutes. Section 4 covers what changed and why the remaining time doesn't compress further without paying for warm compute.

---

## 3. High-level architecture

```
Browser (React + TS, TensorFlow.js for pitch matching, Web Audio API for playback sync)
      |
      v
CloudFront + S3 (static hosting, cache-control: immutable on hashed build assets)
      |
      v
API Gateway (HTTP API + WebSocket API, JWT authorizer against Cognito User Pool)
      |
      +--> Rust Lambda (upload validation + audio fingerprint computation)
      |         |
      |         +--> fingerprint matches existing song? --> link songId, done (no pipeline run)
      |         |
      |         v (new song)
      |    Step Functions (STANDARD workflow — need full history/audit trail, not EXPRESS)
      |         |
      |         v
      |    ChunkAudio (Lambda) --> Map state, fan out N overlapping ~40s chunks in parallel:
      |      SageMaker Processing Jobs (GPU, ml.g4dn.xlarge, per chunk):
      |        Demucs (two-stems) -> faster-whisper (medium) -> Basic Pitch  [Python + PyTorch]
      |                                                              ^
      |                                                              |
      |                                                  C++ DSP core (pybind11 .so)
      |         |
      |         v
      |    StitchResults (Lambda) — overlap-add audio crossfade, offset+merge transcript/pitch by chunk start time
      |         |
      |         v
      |    RunTranslation (Lambda)
      |
      +--> Go Lambda  — WebSocket $connect/$disconnect/push, triggered by DynamoDB Streams
      +--> Java Lambda — learning service: SM-2 scheduling, quiz generation

Data layer:
  S3 (audio/stems, versioned, SSE-S3)
  DynamoDB (job state, song metadata, vocab/spaced-repetition state, WebSocket connections, audio fingerprints — on-demand capacity)
  MongoDB Atlas (M0 free tier — lyrics/translation/timing, one doc per song)
```

**No VPC required.** Every compute component here — API Gateway, Lambda (Python/Rust/Go/Java), SageMaker Processing Jobs, DynamoDB, MongoDB Atlas — reaches what it needs over the public AWS/internet endpoints without needing private subnet placement. This is what falls out of dropping RDS: RDS was the one component in v3 that required VPC placement, and needing to reach it was the reason a NAT Gateway existed for the EKS nodes. With RDS gone, there's nothing left that needs a VPC, so there's no NAT Gateway or Interface Endpoint cost at all.

---

## 4. Orchestration: Step Functions state machine (ASL sketch)

**Two changes from the previous consolidated-single-job version**, both aimed at cutting wall-clock time without adding always-on cost:

1. **Fingerprint short-circuit** — the Rust validation Lambda (Section 5.2a) already computed an audio fingerprint before this state machine even starts. If it matched an existing song, execution never reaches Step Functions at all — the API layer links the new `songId` to the existing pipeline output directly. This ASL only runs for genuinely new songs.
2. **Chunked parallel fan-out** — instead of one SageMaker job processing the whole song sequentially, the audio is split into overlapping ~40-second chunks and processed as parallel jobs via a `Map` state. This doesn't reduce the *cost* of processing a song (SageMaker bills per instance-second either way — 4 instances running 20s each costs about what 1 instance running 80s costs), but it collapses the *wall-clock* time proportionally, since chunks process concurrently instead of one after another.

```json
{
  "Comment": "LyraLearn song processing pipeline (chunked, cache-checked)",
  "StartAt": "MarkProcessing",
  "States": {
    "MarkProcessing": {
      "Type": "Task",
      "Resource": "arn:aws:states:::dynamodb:updateItem",
      "Parameters": {
        "TableName": "LyraLearnTable",
        "Key": { "PK": { "S.$": "$.songPK" }, "SK": { "S.$": "$.jobSK" } },
        "UpdateExpression": "SET #s = :processing",
        "ExpressionAttributeNames": { "#s": "status" },
        "ExpressionAttributeValues": { ":processing": { "S": "PROCESSING" } }
      },
      "Next": "ChunkAudio"
    },
    "ChunkAudio": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Comment": "Splits audio into overlapping ~40s chunks (2-3s overlap for crossfade), uploads each to S3, returns the chunk manifest",
      "Next": "ProcessChunksInParallel",
      "Catch": [{ "ErrorEquals": ["States.ALL"], "Next": "MarkFailed" }]
    },
    "ProcessChunksInParallel": {
      "Type": "Map",
      "ItemsPath": "$.chunks",
      "MaxConcurrency": 6,
      "Iterator": {
        "StartAt": "RunChunkPipeline",
        "States": {
          "RunChunkPipeline": {
            "Type": "Task",
            "Resource": "arn:aws:states:::sagemaker:createProcessingJob.sync",
            "Parameters": {
              "ProcessingJobName.$": "States.Format('lyralearn-chunk-{}', $.chunkId)",
              "AppSpecification": { "ImageUri": "<ecr>/lyralearn-pipeline:latest" },
              "ProcessingResources": {
                "ClusterConfig": { "InstanceType": "ml.g4dn.xlarge", "InstanceCount": 1, "VolumeSizeInGB": 30 }
              },
              "ProcessingInputs": [{ "InputName": "chunk", "S3Input": { "S3Uri.$": "$.chunkS3Uri", "LocalPath": "/opt/ml/processing/input" } }],
              "ProcessingOutputConfig": {
                "Outputs": [{ "OutputName": "chunkResult", "S3Output": { "S3Uri.$": "$.chunkOutputS3Uri", "LocalPath": "/opt/ml/processing/output" } }]
              }
            },
            "Retry": [{ "ErrorEquals": ["States.ALL"], "IntervalSeconds": 30, "MaxAttempts": 2, "BackoffRate": 2.0 }],
            "End": true
          }
        }
      },
      "Next": "StitchResults",
      "Catch": [{ "ErrorEquals": ["States.ALL"], "Next": "MarkFailed" }]
    },
    "StitchResults": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Comment": "Overlap-add crossfade on stem audio; offsets each chunk's transcript lines and pitch notes by chunk start time, then merges and sorts",
      "Next": "RunTranslation",
      "Catch": [{ "ErrorEquals": ["States.ALL"], "Next": "MarkFailed" }]
    },
    "RunTranslation": { "Type": "Task", "Resource": "arn:aws:states:::lambda:invoke", "Next": "MarkComplete", "Catch": [{ "ErrorEquals": ["States.ALL"], "Next": "MarkFailed" }] },
    "MarkComplete": { "Type": "Task", "Resource": "arn:aws:states:::dynamodb:updateItem", "End": true },
    "MarkFailed": { "Type": "Task", "Resource": "arn:aws:states:::dynamodb:updateItem", "End": true }
  }
}
```

`MaxConcurrency: 6` bounds how many chunk jobs run at once — a ~3.5 minute song splits into roughly 5-6 chunks at 40s each, so this comfortably processes the whole song in one wave rather than queueing. `RunChunkPipeline` runs the same consolidated container from Section 5.3 (Demucs two-stems → faster-whisper `medium`, running concurrently with Basic Pitch), just on a chunk instead of the full song — each chunk still pays its own instance boot cost, which is why wall-clock time drops roughly in proportion to concurrency rather than to zero.

Each `MarkFailed`/`MarkComplete` write is what the Go Lambda's DynamoDB Streams trigger picks up to push to the connected client (Section 5.6).

---

## 5. Component breakdown

### 5.1 Frontend
- React + TypeScript, Vite build, deployed as a versioned/hashed bundle to S3 behind CloudFront
- **Progressive hydration player**: audio playback starts as soon as the pre-signed audio URL is available — the player doesn't wait on lyrics, translation, or pitch data. Each of those hydrates in independently as it arrives (via the WebSocket push or polling fallback), so a user can be listening within seconds of upload even though the full pipeline takes ~70-110s for a new song. Lyrics highlighting and pitch-based features simply activate once their data lands, with a lightweight "lyrics loading..." state in the interim.
- React Query for `GET /jobs/{jobId}` polling (exponential backoff, 2s → 15s cap) as the fallback path when the WebSocket connection drops
- Web Audio API `AudioContext.currentTime`, sampled on `requestAnimationFrame`, binary-searched against the MongoDB word-timing array
- **TensorFlow.js**: CREPE model for in-browser pitch matching, lazy-loaded only when sing-along mode is opened (not on initial app load) and cached in IndexedDB across sessions, run in a Web Worker against `getUserMedia` mic input

### 5.2 API layer — endpoint contract

| Method | Path | Auth | Backing service | Notes |
|---|---|---|---|---|
| POST | `/songs` | Cognito JWT | Python Lambda | returns pre-signed PUT URL, `songId` |
| POST | `/songs/{id}/process` | Cognito JWT | Rust Lambda → Step Functions (or direct link on cache hit) | validates + fingerprints (5.2a), starts pipeline or short-circuits, returns `jobId` or `linkedSongId` |
| GET | `/jobs/{id}` | Cognito JWT | Python Lambda | reads DynamoDB, returns status enum |
| GET | `/songs/{id}/lyrics` | Cognito JWT | Python Lambda | proxies MongoDB doc |
| GET | `/songs/{id}/audio-urls` | Cognito JWT | Python Lambda | pre-signed GET URLs, 15 min TTL — available immediately after upload validation, independent of pipeline status |
| WS | `$connect` / `$disconnect` / `$default` | Cognito JWT (query param at connect) | Go Lambda | connection lifecycle + job-status push |
| POST | `/vocab/review` | Cognito JWT | Java Lambda | records a review event, returns next-due date |
| GET | `/vocab/due` | Cognito JWT | Java Lambda | vocab items due today, SM-2 scheduled, queried from DynamoDB |

Everything now sits behind API Gateway directly — HTTP API for REST-style routes, WebSocket API for `/ws`. No ALB, no VPC Link, no separate ingress path: this is the piece that got structurally simpler by dropping EKS, not just cheaper.

### 5.2a Deduplication — audio fingerprinting in the Rust Lambda

Computed as part of the same Rust Lambda that already handles upload validation — no new Lambda function, just an added step in the existing hot path, so this doesn't introduce a new cold-start source.

```rust
// Extends the existing validation Lambda
fn compute_fingerprint(audio_path: &Path) -> Result<String> {
    // chromaprint-based acoustic fingerprint (via a Rust chromaprint binding),
    // not a raw file hash — catches the same song re-encoded/re-uploaded
    // at a different bitrate, which a simple checksum would miss.
    chromaprint::fingerprint_file(audio_path)
}

fn check_duplicate(fingerprint: &str, ddb: &DynamoDbClient) -> Option<String> {
    // Query GSI3 on the fingerprint attribute (Section 6.1)
    ddb.query_by_fingerprint(fingerprint)
}
```

If `check_duplicate` returns an existing `songId`, the Lambda writes a `SONG#{newSongId} / METADATA` item pointing at the existing song's S3/MongoDB references and returns immediately — Step Functions never runs. This only catches songs LyraLearn has already processed (not, say, matching against a public music database), which is the right scope for a language-learning app where the same popular songs get uploaded by multiple users over time.

### 5.3 ML processing — chunked container, pybind11, and speed optimizations

**Changed again from the single-job-per-song design.** Three additional changes beyond the earlier consolidation, all aimed at cutting wall-clock time without adding always-on cost:

- **Chunked processing**: this container now processes one ~40-second audio chunk at a time (Section 4's `Map` state fans multiple chunks out in parallel), not a whole song sequentially
- **Demucs two-stems mode**: only separates vocals vs. everything else, instead of the full 4-way drums/bass/other split — skips computing stems nothing downstream uses
- **`faster-whisper` on `medium`** instead of `large-v3` — faster and lighter, accepting a modest accuracy tradeoff (Section 11)

```dockerfile
FROM pytorch/pytorch:2.3.0-cuda12.1-cudnn8-runtime
RUN pip install demucs==4.0.1 faster-whisper==1.0.3 basic-pitch==0.3.4 pybind11

# Bake model weights into the image layer at build time — no download on job start.
# Both Demucs and Whisper weights need this; only Whisper was covered in an earlier
# version of this Dockerfile, which left Demucs still downloading its checkpoint on
# every job start. Confirm Basic Pitch's bundled model doesn't need the same treatment.
RUN python -c "from demucs.pretrained import get_model; get_model('htdemucs')"
RUN python -c "from faster_whisper import WhisperModel; WhisperModel('medium', device='cpu')"

COPY dsp_core/ /opt/dsp_core/
RUN cd /opt/dsp_core && python setup.py build_ext --inplace

COPY process.py /opt/ml/code/process.py
ENTRYPOINT ["python", "/opt/ml/code/process.py"]
```

```python
# process.py — runs inside a per-chunk SageMaker Processing Job
import concurrent.futures
from faster_whisper import WhisperModel
from demucs_wrapper import separate_two_stems  # demucs --two-stems vocals
from basic_pitch.inference import predict as basic_pitch_predict
import dsp_core

def run(chunk_audio_path: str, chunk_start_offset: float, output_dir: str):
    # Stage 1: two-stems separation (vocals vs. everything else — no drums/bass/other split)
    stems = separate_two_stems(chunk_audio_path, output_dir)

    # Stage 2 + 4: transcription and pitch extraction, concurrent (unchanged pattern)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        whisper_future = pool.submit(transcribe, stems["vocals"])
        pitch_future = pool.submit(extract_pitch, stems["vocals"])
        transcript = whisper_future.result()
        pitch_data = pitch_future.result()

    # chunk_start_offset lets StitchResults (the next state) merge this chunk's
    # timestamps into the full song's timeline without every chunk needing to
    # know about its neighbors
    write_outputs(output_dir, stems, transcript, pitch_data, chunk_start_offset)

def transcribe(vocal_path: str) -> dict:
    model = WhisperModel("medium", device="cuda", compute_type="float16")
    segments, _ = model.transcribe(vocal_path, word_timestamps=True)
    return {"segments": list(segments)}

def extract_pitch(vocal_path: str) -> dict:
    _, midi_data, note_events = basic_pitch_predict(vocal_path)
    beats = dsp_core.detect_beats(*load_samples(vocal_path))
    return {"notes": note_events, "midi": midi_data, "beats": beats}
```

**Chunk-boundary quality tradeoff — worth stating plainly, not glossing over.** `ChunkAudio` (Section 4) creates ~2-3 second overlaps between adjacent chunks specifically so `StitchResults` has room to crossfade the separated audio at the seam rather than producing an audible click, and so a word or note that lands near a cut has a chance of being captured cleanly in at least one of the two overlapping chunks. This works well in practice but isn't perfect — a word split awkwardly across a chunk boundary can still come out slightly off, in a way that never happened in the single-job design. This is a real quality/speed tradeoff, not a free lunch, and worth explicitly validating during Phase 2 (deliberately test chunk boundaries falling mid-lyric, not just at natural pauses) before assuming it's fine.

`dsp_core` (the pybind11 C++ extension for beat detection) is unchanged — still compiled into this image, still called from Python like any other module.

`ml.g4dn.xlarge` remains the instance type, now running per-chunk rather than per-song. Total SageMaker instance-seconds per song stays roughly the same as the single-job design (more jobs, each shorter) — the win here is wall-clock time via parallelism, not a reduction in billed compute.

### 5.3a Stitching chunk results back into one song

A Python Lambda, invoked as the `StitchResults` state after all chunks in a `Map` iteration complete. Two jobs: merge the audio, merge the metadata.

- **Audio**: each chunk's separated vocal/instrumental stems get crossfaded across the ~2-3s overlap region with adjacent chunks (a linear or equal-power crossfade over the overlap window is sufficient — this doesn't need to be sophisticated, just smooth enough that the seam isn't audible), then concatenated into the full-song stems that get written to S3.
- **Transcript and pitch data**: each chunk's Whisper segments and Basic Pitch note events get their timestamps shifted by `chunk_start_offset` (written by `process.py` in Section 5.3) to convert chunk-local time back into full-song time, then all chunks' data gets concatenated and sorted by timestamp. Where the overlap region caused the same word or note to be captured by two adjacent chunks, a simple de-duplication pass (drop near-duplicate entries within the overlap window) cleans that up before the merged `song_lyrics.json`-equivalent gets written.

This Lambda's own runtime is a small, fixed cost regardless of song length — it's doing array manipulation and light audio processing, not GPU inference — so it doesn't meaningfully add to the latency budget.

### 5.4 Storage — access patterns and IAM

**S3** — unchanged: `songs/{songId}/{raw|stems|pitch}/...`, SSE-S3, lifecycle rule to IA after 30 days on `raw/`. SageMaker execution role scoped to `arn:aws:s3:::lyralearn-audio/songs/*`.

**DynamoDB** — now the single relational-adjacent store for everything except lyrics. GSIs needed:
- `GSI1PK = userId, GSI1SK = createdAt` — "my songs, newest first"
- `GSI2PK = userId, GSI2SK = nextReviewAt` — "vocab due today for this user" (replaces the PostgreSQL index from v3)

**MongoDB** — unchanged: unique index on `songId`, add a compound index on `lines.words.text` only if a "find songs containing vocab word X" query pattern actually shows up.

### 5.5 Learning service — Java on Lambda, spaced repetition

Same SM-2 algorithm and package structure as v3, repackaged as a Lambda-backed API instead of a Spring Boot service on EKS. Plain Java Lambda (or Spring Cloud Function if you want to keep Spring idioms and accept the larger cold start) both work here — plain Java Lambda is the leaner choice at this traffic volume.

```java
public class SpacedRepetitionService {
  public UserVocabProgress schedule(UserVocabProgress p, int quality /* 0-5 */) {
    if (quality < 3) {
      p.setIntervalDays(1);
      p.setRepetitions(0);
    } else {
      double ef = p.getEaseFactor();
      ef = ef + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
      p.setEaseFactor(Math.max(1.3, ef));
      int reps = p.getRepetitions() + 1;
      int interval = reps == 1 ? 1 : reps == 2 ? 6 : (int) Math.round(p.getIntervalDays() * p.getEaseFactor());
      p.setIntervalDays(interval);
      p.setRepetitions(reps);
    }
    p.setNextReviewAt(Instant.now().plus(p.getIntervalDays(), ChronoUnit.DAYS));
    return p;
  }
}
```

Persistence swap from v3: instead of a JPA repository writing to `user_vocab_progress`, the Lambda handler calls `DynamoDbClient.updateItem` on `USER#{userId} / VOCAB#{vocabItemId}`, with `easeFactor`, `intervalDays`, `repetitions`, `nextReviewAt` as item attributes. `GET /vocab/due` becomes a `Query` against `GSI2` (`userId` + `nextReviewAt <= now`) instead of the SQL index from v3 — same access pattern, different store.

### 5.6 Notification — Go on Lambda, API Gateway WebSocket API

The in-memory hub pattern from v3 doesn't map to Lambda — Lambda invocations are stateless and short-lived, so there's no persistent `clients` map to hold. The AWS-standard serverless WebSocket pattern replaces it: connection identity is persisted, not held in memory.

```go
// Connect handler — invoked on $connect
func handleConnect(ctx context.Context, req events.APIGatewayWebsocketProxyRequest) (events.APIGatewayProxyResponse, error) {
    userId := extractUserIdFromJWT(req.QueryStringParameters["token"])
    _, err := dynamoClient.PutItem(ctx, &dynamodb.PutItemInput{
        TableName: aws.String("WebSocketConnections"),
        Item: map[string]types.AttributeValue{
            "connectionId": &types.AttributeValueMemberS{Value: req.RequestContext.ConnectionID},
            "userId":       &types.AttributeValueMemberS{Value: userId},
        },
    })
    return events.APIGatewayProxyResponse{StatusCode: 200}, err
}

// Push handler — invoked by a DynamoDB Streams trigger on Job item MODIFY events
func handleJobUpdate(ctx context.Context, event events.DynamoDBEvent) error {
    for _, record := range event.Records {
        if record.EventName != "MODIFY" {
            continue
        }
        userId := extractUserIdFromKey(record.Change.NewImage)
        connectionId := lookupConnectionId(ctx, userId) // query WebSocketConnections table
        apiGwClient.PostToConnection(ctx, &apigatewaymanagementapi.PostToConnectionInput{
            ConnectionId: aws.String(connectionId),
            Data:         marshalJobUpdate(record.Change.NewImage),
        })
    }
    return nil
}
```

Three small Go Lambda functions (`$connect`, `$disconnect`, and the DynamoDB Streams-triggered push handler) replace the single always-on Fargate/EKS hub. `WebSocketConnections` is a small DynamoDB table (`connectionId` as key, `userId` as an attribute with a GSI for the reverse lookup). This is the standard pattern AWS documents for serverless WebSocket APIs — Go's concurrency strengths aren't being used here anymore, since there's no long-lived process holding connections open; the tradeoff is explicit and worth naming rather than glossing over.

---

## 6. Data model — full schemas

### 6.1 DynamoDB
```
Table: LyraLearnTable   (on-demand capacity)
PK (S) | SK (S) | attributes
USER#{userId}  | PROFILE           | name, email, nativeLang, targetLangs
SONG#{songId}  | METADATA          | title, artist, uploadedBy, status, audioFingerprint
SONG#{songId}  | JOB#{jobId}       | stage, status, stageOutputs (map of S3 keys), chunkCount

USER#{userId}  | VOCAB#{vocabId}   | term, definition, easeFactor, intervalDays, repetitions, nextReviewAt, lastReviewedAt

GSI1: GSI1PK=USER#{userId}, GSI1SK=createdAt          -- "my songs, newest first"
GSI2: GSI2PK=USER#{userId}, GSI2SK=nextReviewAt       -- "vocab due today"
GSI3: GSI3PK=audioFingerprint                          -- "has this audio already been processed?" (Section 5.2a)

Table: WebSocketConnections   (on-demand capacity)
PK: connectionId (S)
attributes: userId
GSI: GSI1PK=userId   -- reverse lookup for push
```

### 6.2 MongoDB — unchanged from v3
```json
// db.songLyrics, unique index on songId
{
  "songId": "abc123",
  "sourceLanguage": "ro",
  "targetLanguage": "en",
  "lines": [
    { "lineNumber": 1, "originalText": "...", "translatedText": "...",
      "startTime": 12.4, "endTime": 15.8,
      "words": [ { "text": "...", "start": 12.4, "end": 12.9 } ] }
  ]
}
```

---

## 7. Infrastructure as code (Terraform layout)

```
terraform/
  modules/
    frontend/       # S3 + CloudFront, OAC
    api/             # API Gateway HTTP API + WebSocket API + Lambda (Python, Rust, Go, Java) + Cognito
    orchestration/    # Step Functions state machine + IAM roles
    ml-processing/     # ECR repos, SageMaker Processing Job IAM role
    storage/           # S3 buckets, DynamoDB tables + GSIs, MongoDB Atlas provider
  environments/
    dev/
    prod/
```

No `eks/` module, no VPC module beyond the default. This is meaningfully less Terraform than v3 — one less major module, no IRSA roles, no ALB/Ingress configuration. IAM roles stay scoped per-Lambda-function, same principle as v3's per-service scoping.

---

## 8. Cost — MVP live deployment (Tier A: 30-50 users, 20-30 songs/month)

| Component | Monthly cost | Notes |
|---|---|---|
| EKS control plane + nodes | $0 | removed |
| NAT Gateway / VPC Endpoints | $0 | nothing left requires VPC placement |
| RDS PostgreSQL | $0 | removed, vocab state moved to DynamoDB |
| Lambda (Python, Rust, Go, Java — all functions, plus the new `ChunkAudio`/`StitchResults` steps) | ~$0-2 | comfortably within the always-free tier at this volume; a couple more Lambda invocations per song is negligible |
| API Gateway (HTTP + WebSocket) | ~$1 | |
| DynamoDB on-demand | ~$1 | job state, song metadata, vocab, WS connections, audio fingerprints |
| MongoDB Atlas (M0) | $0 | free tier, ample headroom at this scale |
| SageMaker Processing (20-30 songs/month) | ~$2-3 | ~$0.10/song — chunking runs more, shorter jobs in parallel instead of fewer, longer ones; total instance-seconds per song is roughly unchanged, so this line item doesn't move |
| Step Functions (state transitions, including the `Map` state) | ~$0-1 | more states per execution than the single-job design, still negligible at this volume — first 4,000 transitions/month are free |
| S3 + CloudFront | ~$1-2 | slightly more S3 traffic for chunk intermediates, still negligible |
| Cognito | $0 | free under 50,000 MAU |
| Route 53 hosted zone | ~$0.50 | |
| **Total** | **~$6-10/month** | unchanged — every speed change here was chosen specifically because it doesn't move this number |

Watch MongoDB Atlas storage/connection metrics as the one thing that can jump this number — M0 → M10 is a step to ~$57/month on its own, independent of everything else here.

---

## 9. Security considerations

- Cognito User Pool as the single identity source; API Gateway JWT authorizer on HTTP routes, and the Go WebSocket connect handler validates the same JWT at `$connect` time
- Pre-signed S3 URLs: upload PUT (5 min TTL, content-type restricted), playback GET (15 min TTL)
- No VPC needed at this tier — every component talks over public AWS/internet endpoints with IAM/JWT-based auth rather than network isolation. This is an acceptable, deliberate tradeoff at this scale, where the attack surface is small and every credential is scoped tightly per-function
- Secrets (MongoDB Atlas connection string) in AWS Secrets Manager, read directly by Lambda at cold start (cached in execution environment across warm invocations) rather than injected via any container-orchestration secret-mounting mechanism
- IAM roles scoped per-Lambda-function — no wildcard `s3:*`/`dynamodb:*`, no shared execution role across functions

---

## 10. Phased build plan

Each sub-phase below has a "done when" marker — a concrete, checkable condition, not just a task description. The idea is that any sub-phase can be picked up or paused independently without losing track of what "finished" means for it.

### Phase 1 — Local pipeline, no AWS

**1.1 Environment + Demucs only.** Set up the venv, get `demucs.separate --two-stems vocals` running on one test song.
Done when: `vocals.wav` is audibly clean with minimal instrumental bleed.

**1.2 Add transcription.** Wire in `faster-whisper` on the vocal stem, `word_timestamps=True`.
Done when: word-level timestamps are within ~200-300ms of correct when scrubbed against the audio.

**1.3 Add translation.** Wire in Helsinki-NLP, batched line-by-line translation.
Done when: translated text is coherent against the known lyrics (this is the step where knowing Romanian is a genuine advantage).

**1.4 Add pitch extraction.** Wire in Basic Pitch against the vocal stem.
Done when: the `.mid` note contour matches the audible melody on playback.

**1.5 Wire the full pipeline.** Chain 1.1-1.4 into `pipeline.py`, output `song_lyrics.json` in the exact MongoDB doc shape (Section 6.2), thread `songId` through from the start.
Done when: one command runs start to finish with no manual steps, and you have real per-stage timing numbers instead of estimates.

### Phase 2 — ML pipeline in AWS

**2.1 Containerize, single manual run.** Build the consolidated Demucs+Whisper+Basic Pitch Dockerfile (Section 5.3, no chunking yet — whole song in one job), push to ECR, manually trigger one SageMaker Processing Job via CLI/console on the same test song from Phase 1.
Done when: the job completes and its S3 output matches what Phase 1 produced locally.

**2.2 Bake in model weights.** Add the `RUN python -c "..."` layers for both Demucs and Whisper (Section 5.3 — this is the step an earlier version of this doc missed for Demucs specifically).
Done when: job start-to-first-inference time visibly drops versus 2.1's cold run.

**2.3 Build the linear Step Functions ASL.** `MarkProcessing → RunMLPipeline → RunTranslation → MarkComplete/Failed` (Section 4, pre-chunking version), triggered manually with a test payload — no API layer yet.
Done when: a full execution shows green in the Step Functions console history, including a deliberately-forced failure path (bad audio file) hitting `MarkFailed` correctly.

**2.4 Add chunking.** `ChunkAudio` Lambda, `Map` state fan-out, per-chunk SageMaker jobs running the same container against a chunk instead of a whole song.
Done when: all chunks for one song complete and land in S3 with correct `chunk_start_offset` metadata.

**2.5 Add `StitchResults`.** Crossfade audio at overlaps, offset and merge/dedupe transcript lines and pitch notes.
Done when: the stitched output is indistinguishable from the un-chunked Phase 2.1 output on a song with no lyric near a chunk boundary — **and then** deliberately test a song where a chunk cut lands mid-word or mid-note, and document what actually happens (Section 5.3's stated tradeoff should be verified, not assumed).

**2.6 End-to-end timing validation.** Run the full chunked pipeline against several real songs of varying length.
Done when: you have real numbers to compare against the ~70-110s target — not to hit the number exactly, but to know where reality diverges from the estimate.

### Phase 3 — API layer, auth, and deduplication

**3.1 Cognito + DynamoDB foundation.** User Pool, JWT authorizer, `LyraLearnTable` with GSI1/GSI2/GSI3, `WebSocketConnections` table (empty/unused until Phase 6, but schema live now).
Done when: you can issue a JWT and read/write a test item via each GSI.

**3.2 Core Python Lambda routes.** `POST /songs`, `GET /jobs/{id}`, `GET /songs/{id}/lyrics`, `GET /songs/{id}/audio-urls`.
Done when: each route is callable via Postman with a real JWT and returns correctly shaped responses against test data seeded directly in DynamoDB/MongoDB.

**3.3 Rust Lambda — validation only.** Upload header/format/size checks, no fingerprinting yet.
Done when: a malformed upload is rejected before it ever reaches Step Functions.

**3.4 Rust Lambda — add fingerprinting.** Wire in the chromaprint-based fingerprint computation and the `GSI3` duplicate check (Section 5.2a).
Done when: uploading the same song twice (even re-encoded at a different bitrate) links the second upload to the first song's existing data instead of running the pipeline again.

**3.5 Wire it all together.** `POST /songs/{id}/process` triggers either the Step Functions execution from Phase 2 (cache miss) or the direct-link path (cache hit).
Done when: both paths are exercised end-to-end via Postman — one full pipeline run, one instant cache hit — with correct `songId` linkage in both cases.

### Phase 4 — Frontend

**4.1 Scaffold + auth.** React + TS + Vite, Cognito login flow, deployed to S3/CloudFront.
Done when: a real user can sign up, log in, and see an authenticated shell.

**4.2 Upload + job status.** Upload flow hitting `POST /songs`, then `POST /songs/{id}/process`, with React Query polling `GET /jobs/{id}`.
Done when: you can watch a real song go from upload through pipeline completion, reflected in the UI.

**4.3 Player shell — immediate playback.** Audio playback wired to the pre-signed URL from `GET /songs/{id}/audio-urls`, starting as soon as it's available — independent of pipeline completion (Section 5.1's core UX claim).
Done when: playback starts within seconds of upload validation, well before the pipeline finishes.

**4.4 Lyrics hydration.** Word-synced highlighting driven by the MongoDB doc, `AudioContext.currentTime` binary-searched against the word-timing array, hydrating in once the pipeline completes.
Done when: highlighting is accurate and appears without a page reload or manual refresh once processing finishes.

**4.5 Loading/error states.** "Lyrics loading..." placeholder, failed-job handling, retry affordance.
Done when: a deliberately-forced pipeline failure (Phase 2.3's test case) surfaces a real error state in the UI instead of a silent hang.

### Phase 5 — Learning service

**5.1 Data + skeleton.** Vocab items in DynamoDB, `GSI2` due-today query, empty Java Lambda deployed and reachable.
Done when: a manually-inserted vocab item is queryable via `GSI2`.

**5.2 SM-2 logic, tested in isolation.** Implement `SpacedRepetitionService.schedule()` (Section 5.5) with unit tests covering quality scores 0-5, independent of any AWS call.
Done when: unit tests pass against known SM-2 reference outputs, not just "the code runs."

**5.3 Wire the endpoints.** `POST /vocab/review`, `GET /vocab/due`, connected to DynamoDB.
Done when: a review event correctly updates `nextReviewAt`, and `/vocab/due` reflects it.

**5.4 Quiz generation.** Pulls lyrics context from MongoDB to build review prompts.
Done when: a generated quiz question references real lyric context from an actual processed song, not placeholder text.

**5.5 Frontend integration.** Vocab review UI, due-today list, wired into the player from Phase 4.
Done when: a full loop works — play a song, encounter vocab, review it later, see it scheduled correctly.

### Phase 6 — Real-time and polish

**6.1 WebSocket connection lifecycle.** `$connect`/`$disconnect` Go Lambdas writing/deleting `WebSocketConnections` rows.
Done when: connecting and disconnecting a test WebSocket client correctly updates the table.

**6.2 Push on job completion.** DynamoDB Streams trigger → push handler (Section 5.6), tested against a real Phase 2 pipeline run.
Done when: a connected client receives a push the moment `MarkComplete` writes, without polling.

**6.3 Frontend WebSocket integration.** Swap the primary status-update path from polling to WebSocket, keeping polling as the documented fallback (Section 5.1).
Done when: the polling fallback still works correctly if the WebSocket connection is deliberately killed mid-session.

**6.4 TensorFlow.js sing-along mode.** CREPE model, lazy-loaded on mode open, cached in IndexedDB, running in a Web Worker.
Done when: opening sing-along mode a second time (same device) loads noticeably faster than the first, confirming the cache is working.

**6.5 C++ DSP core — conditional.** Only build this if Basic Pitch's stock tempo/beat detection shows a measurable gap on real songs from Phase 1/2 — benchmark first, build second.
Done when: either the gap is confirmed and `dsp_core` closes it, or it's confirmed unnecessary and explicitly skipped.

---

## 11. Open decisions

- Translation granularity: line-by-line vs phrase-level
- ~~Whisper `large-v3` vs `medium`~~ — **resolved to `medium`** for the cost-neutral speed win (Section 5.3); revisit only if Phase 1/2 benchmarking shows the accuracy gap is unacceptable for real lyrics
- MongoDB Atlas vs DocumentDB — Atlas first for speed and the free tier; DocumentDB only becomes worth revisiting if this ever moves back inside a VPC for other reasons
- Build the C++ DSP core only if Basic Pitch's output shows a measurable gap
- Plain Java Lambda vs Spring Cloud Function for the learning service — plain Lambda is the leaner, cheaper choice at this scale
- **New**: chunk overlap duration (currently ~2-3s) — this is a tuning knob between stitch quality and wasted redundant compute at the seams; validate against real songs in Phase 2 rather than assuming the initial estimate is right
- **New**: how aggressively to dedupe via audio fingerprinting — chromaprint-based matching can have false positives on very similar-sounding but distinct tracks (e.g. two different live recordings of the same song); worth a manual review step before auto-linking in the early going, rather than trusting it blindly from day one

---

## 12. Technology-to-purpose summary (MVP tier)

| Technology | Where | Why |
|---|---|---|
| AWS | Everywhere | Lambda, API Gateway (HTTP + WebSocket), SageMaker, S3, DynamoDB, Cognito, Terraform |
| Python | ML pipeline, core Lambda | Demucs/Whisper/Helsinki-NLP/Basic Pitch runtime |
| PyTorch | ML pipeline | Underlying framework for the 3 GPU stages |
| React + JS | Frontend | SPA, Web Audio sync, React Query polling |
| TensorFlow.js | Client | In-browser CREPE pitch matching |
| Rust | Upload-validation Lambda | Low cold-start on the hot path |
| Go | WebSocket Lambda functions | `$connect`/`$disconnect`/push handlers, DynamoDB Streams trigger |
| Java | Learning service Lambda | SM-2 scheduling logic |
| C++ | DSP core via pybind11 | Performance-critical beat/tempo detection |
| DynamoDB | Job state, song metadata, vocab, WS connections | Single store for everything except lyrics |
| MongoDB | Lyrics/translation/timing | Nested document shape matches Whisper output |
