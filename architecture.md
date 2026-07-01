# LyraLearn — Architecture & Design Doc

## 1. What this doc covers

Technical foundation for LyraLearn: a music-based language learning platform that separates a song into stems, transcribes and translates the lyrics, and extracts melody/pitch data for an interactive, word-synced learning player.

This version (v3) goes deeper than a component list — actual API contracts, state machine definitions, schemas with types and indexes, IAM scoping, and the specific algorithm choices (e.g. SM-2 for spaced repetition) needed to actually start building each piece. 14 technologies integrated: AWS, Python, PyTorch, React, JavaScript, TensorFlow, Rust, Go, Java/Spring Boot, C++, Kubernetes, DynamoDB, MongoDB, PostgreSQL.

---

## 2. User journey and sequencing

1. `POST /auth/*` — Cognito-backed signup/login, returns JWT
2. `POST /songs` — client requests a pre-signed S3 upload URL
3. Client `PUT`s the audio file directly to S3
4. `POST /songs/{songId}/process` — triggers Rust validation Lambda, then Step Functions execution
5. Client subscribes to job status: either polls `GET /jobs/{jobId}` or opens a WebSocket to the Go service
6. On `COMPLETE`, client fetches `GET /songs/{songId}/lyrics` (MongoDB-backed) and `GET /songs/{songId}/audio-urls` (pre-signed playback URLs), renders the player
7. During/after playback, vocab events are POSTed to the Java learning service, which schedules future reviews

Latency budget that shapes the design: step 4-6 is 3-6 minutes end to end (GPU-bound), everything else is sub-second. This is why steps 4-6 are fully async and decoupled from the request/response cycle.

---

## 3. High-level architecture

```
Browser (React + TS, TensorFlow.js for pitch matching, Web Audio API for playback sync)
      |
      v
CloudFront + S3 (static hosting, cache-control: immutable on hashed build assets)
      |
      v
API Gateway (HTTP API, JWT authorizer against Cognito User Pool)
      |
      +--> Rust Lambda (upload validation: ffprobe-style header check, format/size limits)
      |         |
      |         v
      |    Step Functions (STANDARD workflow — need full history/audit trail, not EXPRESS)
      |         |
      |         v
      |    SageMaker Processing Jobs (GPU, ml.g4dn.xlarge, one container per stage):
      |      Demucs -> Whisper -> Helsinki-NLP -> Basic Pitch  [Python + PyTorch]
      |         |                                    ^
      |         |                                    |
      |         +---- C++ DSP core (pybind11 .so, baked into the Basic Pitch container)
      |
      +--> EKS (2 node groups: general + none needed for GPU here, GPU stays in SageMaker)
                Go deployment  — WebSocket hub, subscribes to DynamoDB Streams
                Java deployment — Spring Boot, learning service, talks to RDS PostgreSQL

Data layer:
  S3 (audio/stems, versioned, SSE-S3)
  DynamoDB (job state, song metadata — on-demand capacity mode)
  DocumentDB or MongoDB Atlas (lyrics/translation/timing, one doc per song)
  RDS PostgreSQL (vocab, spaced-repetition state, Multi-AZ off for dev, on for prod)
```

---

## 4. Orchestration: Step Functions state machine (ASL sketch)

```json
{
  "Comment": "LyraLearn song processing pipeline",
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
      "Next": "RunDemucs"
    },
    "RunDemucs": {
      "Type": "Task",
      "Resource": "arn:aws:states:::sagemaker:createProcessingJob.sync",
      "Parameters": {
        "ProcessingJobName.$": "States.Format('demucs-{}', $.jobId)",
        "AppSpecification": { "ImageUri": "<ecr>/lyralearn-demucs:latest" },
        "ProcessingResources": {
          "ClusterConfig": { "InstanceType": "ml.g4dn.xlarge", "InstanceCount": 1, "VolumeSizeInGB": 30 }
        },
        "ProcessingInputs": [{ "InputName": "audio", "S3Input": { "S3Uri.$": "$.audioS3Uri", "LocalPath": "/opt/ml/processing/input" } }],
        "ProcessingOutputConfig": {
          "Outputs": [{ "OutputName": "stems", "S3Output": { "S3Uri.$": "$.stemsS3Uri", "LocalPath": "/opt/ml/processing/output" } }]
        }
      },
      "Retry": [{ "ErrorEquals": ["States.ALL"], "IntervalSeconds": 30, "MaxAttempts": 2, "BackoffRate": 2.0 }],
      "Catch": [{ "ErrorEquals": ["States.ALL"], "Next": "MarkFailed" }],
      "Next": "RunWhisper"
    },
    "RunWhisper": { "Type": "Task", "Resource": "arn:aws:states:::sagemaker:createProcessingJob.sync", "Next": "RunTranslation", "Catch": [{ "ErrorEquals": ["States.ALL"], "Next": "MarkFailed" }] },
    "RunTranslation": { "Type": "Task", "Resource": "arn:aws:states:::lambda:invoke", "Next": "RunBasicPitch", "Catch": [{ "ErrorEquals": ["States.ALL"], "Next": "MarkFailed" }] },
    "RunBasicPitch": { "Type": "Task", "Resource": "arn:aws:states:::sagemaker:createProcessingJob.sync", "Next": "MarkComplete", "Catch": [{ "ErrorEquals": ["States.ALL"], "Next": "MarkFailed" }] },
    "MarkComplete": { "Type": "Task", "Resource": "arn:aws:states:::dynamodb:updateItem", "End": true },
    "MarkFailed": { "Type": "Task", "Resource": "arn:aws:states:::dynamodb:updateItem", "End": true }
  }
}
```

Notes:
- `.sync` suffix on the SageMaker integration blocks the state machine until the job finishes — no manual polling logic needed.
- STANDARD (not EXPRESS) workflow type: you get up to a year of execution history in the console, which matters for debugging a 4-stage GPU pipeline where something *will* fail intermittently (OOM on a long song, malformed audio, etc).
- Each `MarkFailed`/`MarkComplete` write is what the Go service's DynamoDB Streams subscription picks up to push to the client.

---

## 5. Component breakdown

### 5.1 Frontend
- React + TypeScript, Vite build, deployed as a versioned/hashed bundle to S3 behind CloudFront
- Data fetching: React Query (TanStack Query) for `GET /jobs/{jobId}` polling with exponential backoff (start at 2s, cap at 15s) as the fallback path when WebSocket isn't connected
- Playback sync: Web Audio API `AudioContext.currentTime`, sampled on a `requestAnimationFrame` loop, binary-searched against the sorted word-timing array from MongoDB to find the active word — this is cheaper than a `setInterval` re-render loop and stays in sync with actual audio playback rather than wall-clock time
- **TensorFlow.js**: CREPE model (from Magenta) loaded via `@tensorflow-models`, run against `getUserMedia` mic input in a Web Worker so pitch inference doesn't block the main thread during playback

### 5.2 API layer — endpoint contract

| Method | Path | Auth | Backing service | Notes |
|---|---|---|---|---|
| POST | `/songs` | Cognito JWT | Python Lambda | returns pre-signed PUT URL, `songId` |
| POST | `/songs/{id}/process` | Cognito JWT | Rust Lambda → Step Functions | starts pipeline, returns `jobId` |
| GET | `/jobs/{id}` | Cognito JWT | Python Lambda | reads DynamoDB, returns status enum |
| GET | `/songs/{id}/lyrics` | Cognito JWT | Python Lambda | proxies MongoDB doc |
| GET | `/songs/{id}/audio-urls` | Cognito JWT | Python Lambda | pre-signed GET URLs, 15 min TTL |
| WS | `/ws` | Cognito JWT (query param at connect) | Go service (ALB → EKS) | job-status push |
| POST | `/vocab/review` | Cognito JWT | Java service (separate ALB → EKS) | records a review event, returns next-due date |
| GET | `/vocab/due` | Cognito JWT | Java service | vocab items due today, SM-2 scheduled |

Two ALBs (or one ALB with path-based routing) split traffic between the API Gateway/Lambda surface and the EKS-hosted services — API Gateway does not natively proxy to EKS pods without a VPC Link, so `/vocab/*` and `/ws` route through a separate ALB Ingress directly.

### 5.3 ML processing — container and pybind11 detail

Each SageMaker Processing Job container follows the same shape:
```dockerfile
FROM pytorch/pytorch:2.3.0-cuda12.1-cudnn8-runtime
COPY dsp_core/ /opt/dsp_core/
RUN pip install pybind11 && cd /opt/dsp_core && python setup.py build_ext --inplace
COPY process.py /opt/ml/code/process.py
ENTRYPOINT ["python", "/opt/ml/code/process.py"]
```

C++ DSP core exposed via pybind11 — the Python side calls it like a normal module:
```cpp
// dsp_core/beat_detect.cpp
#include <pybind11/pybind11.h>
#include <pybind11/stl.h>
namespace py = pybind11;

std::vector<double> detect_beats(const std::vector<float>& samples, int sample_rate);

PYBIND11_MODULE(dsp_core, m) {
    m.def("detect_beats", &detect_beats, "Onset-based beat detection");
}
```
```python
# process.py (Basic Pitch stage)
import dsp_core
beats = dsp_core.detect_beats(audio_samples, sample_rate)  # calls into compiled C++
```
Instance sizing: `ml.g4dn.xlarge` (1x T4 GPU, 4 vCPU, 16GB) is the starting point for Demucs/Whisper; Basic Pitch is lighter and could run on a smaller/CPU instance if cost matters more than pipeline latency — worth benchmarking both once the pipeline is live.

### 5.4 Storage — access patterns and IAM

**S3** — bucket layout `songs/{songId}/{raw|stems|pitch}/...`, SSE-S3 encryption, lifecycle rule to transition `raw/` to Infrequent Access after 30 days (stems/pitch stay Standard since they're read on every playback). IAM policy for the SageMaker execution role is scoped to `arn:aws:s3:::lyralearn-audio/songs/*` only — never bucket-wide.

**DynamoDB** — GSI needed: `GSI1PK = userId, GSI1SK = createdAt` to support "list a user's songs sorted by upload date" without a table scan. Base table access is single-item `GetItem`/`UpdateItem` by `PK`/`SK`, which stays cheap under on-demand billing at this scale.

**MongoDB** — index on `songId` (unique), and a compound index if you ever need "find all songs containing vocab word X" (`lines.words.text`). Start with just the unique index; add the text index only if that query pattern actually shows up.

**PostgreSQL** — see 5.6 for DDL. Index on `user_vocab_progress(user_id, next_review_at)` since "vocab due today for this user" is the hottest query in the learning service.

### 5.5 Learning service — Java + Spring Boot, spaced repetition

Package structure:
```
com.lyralearn.learning
  controller/  VocabController.java, ReviewController.java
  service/     SpacedRepetitionService.java, QuizGenerationService.java
  repository/  VocabItemRepository.java (Spring Data JPA)
  model/       VocabItem.java, UserVocabProgress.java, ReviewHistory.java
```

Scheduling algorithm: **SM-2** (the SuperMemo-2 algorithm, same one Anki uses) — well-understood, simple to implement correctly, and appropriate for vocab review rather than something more elaborate:
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
`POST /vocab/review` takes a `quality` score (0-5, self-assessed or derived from quiz correctness), runs it through this function, writes the updated row, returns the new `nextReviewAt`.

### 5.6 Notification service — Go, WebSocket hub pattern

Standard fan-out hub, one goroutine per connection plus a central broadcast loop:
```go
type Hub struct {
    clients    map[string]*Client // keyed by userId
    broadcast  chan JobUpdate
    register   chan *Client
    unregister chan *Client
}

func (h *Hub) run() {
    for {
        select {
        case c := <-h.register:
            h.clients[c.userId] = c
        case c := <-h.unregister:
            delete(h.clients, c.userId)
            close(c.send)
        case update := <-h.broadcast:
            if c, ok := h.clients[update.UserID]; ok {
                c.send <- update
            }
        }
    }
}
```
`update`s arrive from a separate goroutine consuming a DynamoDB Streams Kinesis adapter (`aws-sdk-go` `dynamodbstreams` package), filtered to `MODIFY` events on `Job` items, mapped to the owning `userId` via the item's `PK`. Each client connection gets its own read/write goroutine pair; the hub's central loop is the only place that touches the `clients` map, avoiding lock contention.

### 5.7 Kubernetes (EKS)

Two Deployments, one per service, each behind its own Service + Ingress path:
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: go-notification-service
spec:
  replicas: 2
  template:
    spec:
      containers:
        - name: notification-service
          image: <ecr>/lyralearn-notify:latest
          resources:
            requests: { cpu: "100m", memory: "64Mi" }
            limits:   { cpu: "500m", memory: "256Mi" }
          readinessProbe:
            httpGet: { path: /healthz, port: 8080 }
```
`replicas: 2` minimum for the Go service specifically, since it holds long-lived WebSocket connections — losing the single pod would drop every open connection at once. HorizontalPodAutoscaler on both deployments targeting 70% CPU, with the Go service additionally worth watching on connection count (custom metric via Prometheus adapter) rather than CPU alone, since idle WebSocket connections are cheap on CPU but still consume memory/file descriptors.

---

## 6. Data model — full schemas

### 6.1 DynamoDB
```
Table: LyraLearnTable   (on-demand capacity)
PK (S) | SK (S) | attributes
USER#{userId}  | PROFILE           | name, email, nativeLang, targetLangs
SONG#{songId}  | METADATA          | title, artist, uploadedBy, status
SONG#{songId}  | JOB#{jobId}       | stage, status, stageOutputs (map of S3 keys)

GSI1: GSI1PK=USER#{userId}, GSI1SK=createdAt   -- "my songs, newest first"
```

### 6.2 MongoDB
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

### 6.3 PostgreSQL
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dynamo_user_id TEXT UNIQUE NOT NULL,
  native_language TEXT NOT NULL
);

CREATE TABLE vocab_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  term TEXT NOT NULL,
  target_language TEXT NOT NULL,
  definition TEXT,
  source_song_id TEXT NOT NULL
);

CREATE TABLE user_vocab_progress (
  user_id UUID REFERENCES users(id),
  vocab_item_id UUID REFERENCES vocab_items(id),
  ease_factor NUMERIC(3,2) NOT NULL DEFAULT 2.5,
  interval_days INT NOT NULL DEFAULT 0,
  repetitions INT NOT NULL DEFAULT 0,
  next_review_at TIMESTAMPTZ NOT NULL,
  last_reviewed_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, vocab_item_id)
);
CREATE INDEX idx_due_reviews ON user_vocab_progress (user_id, next_review_at);

CREATE TABLE review_history (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  vocab_item_id UUID REFERENCES vocab_items(id),
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  quality SMALLINT NOT NULL CHECK (quality BETWEEN 0 AND 5)
);
```

---

## 7. Infrastructure as code (Terraform layout)

```
terraform/
  modules/
    frontend/     # S3 + CloudFront, OAC (not legacy OAI)
    api/           # API Gateway HTTP API + Lambda (Python, Rust) + Cognito User Pool
    orchestration/ # Step Functions state machine (from templatefile()) + IAM roles
    ml-processing/  # ECR repos, SageMaker Processing Job IAM role
    eks/            # EKS cluster, managed node group, IRSA roles for Go/Java pods
    storage/        # S3 buckets, DynamoDB table + GSI, RDS PostgreSQL, MongoDB Atlas provider
  environments/
    dev/  (single-AZ RDS, on-demand DynamoDB, smaller node group)
    prod/ (Multi-AZ RDS, autoscaling node group)
```
Use IRSA (IAM Roles for Service Accounts) for the Go and Java pods rather than node-level IAM roles — scopes DynamoDB Streams read access to the Go service specifically and RDS/Secrets Manager access to the Java service specifically, without either pod inheriting the other's permissions.

---

## 8. Cost considerations

| Component | Cost driver | Mitigation |
|---|---|---|
| SageMaker Processing Jobs | per-second GPU billing, ~3-5 min/song | small fixed test-song set during dev, not re-processing on every commit |
| RDS PostgreSQL | always-on instance | `db.t4g.micro` for dev, Multi-AZ only in prod |
| EKS | control plane ($0.10/hr) + node group | 2 small nodes (`t4g.medium`) is enough for 2 low-traffic deployments at prototype stage |
| DynamoDB | on-demand read/write | negligible at this scale; switch to provisioned + autoscaling only if traffic becomes predictable |
| MongoDB Atlas | managed cluster tier | M0 (free tier) is sufficient through most of development |
| CloudFront + S3 | egress on audio playback | cache stems aggressively (`Cache-Control: max-age=31536000` — content-addressed by songId, effectively immutable) |

---

## 9. Security considerations

- Cognito User Pool as the single identity source; API Gateway JWT authorizer, and Go/Java services validate the same JWT via the pool's JWKS endpoint (no shared secret, no duplicated auth logic)
- Pre-signed S3 URLs: upload PUT (5 min TTL, content-type restricted), playback GET (15 min TTL)
- VPC design: SageMaker Processing Jobs and RDS in private subnets with no direct internet route; EKS nodes in private subnets behind a NAT gateway; only the ALBs and CloudFront sit in/behind public-facing infrastructure
- Secrets (RDS credentials, MongoDB connection string) in AWS Secrets Manager, mounted into EKS pods via the Secrets Store CSI Driver rather than plain Kubernetes Secrets
- IAM roles scoped per-function/per-service (see 7) — no wildcard `s3:*`/`dynamodb:*`, no shared execution role across stages

---

## 10. Phased build plan

**Phase 1** — plain Python script, no AWS: Demucs → Whisper → Helsinki-NLP → Basic Pitch on one local file. Validate before building infrastructure.

**Phase 2** — containerize, push to ECR, wire up SageMaker Processing Jobs + the Step Functions ASL from section 4. Trigger manually, no API yet.

**Phase 3** — API Gateway + Python/Rust Lambda, Cognito, DynamoDB table + GSI live. Submit and poll via Postman.

**Phase 4** — React frontend: upload, polling UI, MongoDB-backed player with Web Audio sync.

**Phase 5** — Java/Spring Boot learning service on EKS + RDS PostgreSQL, SM-2 scheduling, `/vocab/review` and `/vocab/due` endpoints.

**Phase 6** — Go notification service on EKS (DynamoDB Streams → WebSocket), TensorFlow.js pitch matching, C++ DSP core if Basic Pitch's stock tempo detection proves insufficient.

---

## 11. Open decisions

- Translation granularity: line-by-line vs phrase-level
- Whisper `large-v3` vs `medium` — benchmark accuracy/latency/cost on real songs before committing
- WebSocket vs polling — ship polling first (Phase 3), add Go service only once polling UX genuinely suffers
- MongoDB Atlas vs DocumentDB — Atlas first for speed, DocumentDB later if unified AWS billing/IAM matters more
- Build the C++ DSP core only if Basic Pitch's output shows a measurable gap — don't build it speculatively

---

## 12. Technology-to-purpose summary

| Technology | Where | Why |
|---|---|---|
| AWS | Everywhere | Lambda, API Gateway, SageMaker, S3, DynamoDB, EKS, Cognito, RDS, Terraform |
| Python | ML pipeline, core Lambda | Demucs/Whisper/Helsinki-NLP/Basic Pitch runtime |
| PyTorch | ML pipeline | Underlying framework for the 3 GPU stages |
| React + JS | Frontend | SPA, Web Audio sync, React Query polling |
| TensorFlow.js | Client | In-browser CREPE pitch matching |
| Rust | Upload-validation Lambda | Low cold-start on the hot path |
| Go | EKS notification service | Goroutine concurrency for many WebSocket connections |
| Java + Spring Boot | EKS learning service | SM-2 scheduling, relational domain logic |
| C++ | DSP core via pybind11 | Performance-critical beat/tempo detection |
| Kubernetes (EKS) | Hosts Go + Java | Always-on workloads, IRSA-scoped permissions |
| DynamoDB | Job state, song metadata | Key-value lookups, GSI for "my songs" |
| MongoDB | Lyrics/translation/timing | Nested document shape matches Whisper output |
| PostgreSQL | Vocab, spaced repetition | Relational: users × vocab × review history |
