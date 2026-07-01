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
4. `POST /songs/{songId}/process` — triggers Rust validation Lambda, then Step Functions execution
5. Client subscribes to job status via API Gateway WebSocket API (Go Lambda backing it), with polling `GET /jobs/{jobId}` as fallback
6. On `COMPLETE`, client fetches `GET /songs/{songId}/lyrics` (MongoDB-backed) and `GET /songs/{songId}/audio-urls` (pre-signed playback URLs), renders the player
7. During/after playback, vocab events are POSTed to the learning API (Java Lambda), which schedules future reviews in DynamoDB

Latency budget unchanged from v3: step 4-6 is 3-6 minutes end to end (GPU-bound), everything else is sub-second, so steps 4-6 stay fully async and decoupled from the request/response cycle.

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
      +--> Rust Lambda (upload validation: header check, format/size limits)
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
      +--> Go Lambda  — WebSocket $connect/$disconnect/push, triggered by DynamoDB Streams
      +--> Java Lambda — learning service: SM-2 scheduling, quiz generation

Data layer:
  S3 (audio/stems, versioned, SSE-S3)
  DynamoDB (job state, song metadata, vocab/spaced-repetition state, WebSocket connections — on-demand capacity)
  MongoDB Atlas (M0 free tier — lyrics/translation/timing, one doc per song)
```

**No VPC required.** Every compute component here — API Gateway, Lambda (Python/Rust/Go/Java), SageMaker Processing Jobs, DynamoDB, MongoDB Atlas — reaches what it needs over the public AWS/internet endpoints without needing private subnet placement. This is what falls out of dropping RDS: RDS was the one component in v3 that required VPC placement, and needing to reach it was the reason a NAT Gateway existed for the EKS nodes. With RDS gone, there's nothing left that needs a VPC, so there's no NAT Gateway or Interface Endpoint cost at all.

---

## 4. Orchestration: Step Functions state machine (ASL sketch)

Unchanged from v3 — this part of the pipeline was never EKS or RDS dependent.

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

Each `MarkFailed`/`MarkComplete` write is what the Go Lambda's DynamoDB Streams trigger picks up to push to the connected client (Section 5.6).

---

## 5. Component breakdown

### 5.1 Frontend
Unchanged from v3.
- React + TypeScript, Vite build, deployed as a versioned/hashed bundle to S3 behind CloudFront
- React Query for `GET /jobs/{jobId}` polling (exponential backoff, 2s → 15s cap) as the fallback path when the WebSocket connection drops
- Web Audio API `AudioContext.currentTime`, sampled on `requestAnimationFrame`, binary-searched against the MongoDB word-timing array
- **TensorFlow.js**: CREPE model for in-browser pitch matching, run in a Web Worker against `getUserMedia` mic input

### 5.2 API layer — endpoint contract

| Method | Path | Auth | Backing service | Notes |
|---|---|---|---|---|
| POST | `/songs` | Cognito JWT | Python Lambda | returns pre-signed PUT URL, `songId` |
| POST | `/songs/{id}/process` | Cognito JWT | Rust Lambda → Step Functions | starts pipeline, returns `jobId` |
| GET | `/jobs/{id}` | Cognito JWT | Python Lambda | reads DynamoDB, returns status enum |
| GET | `/songs/{id}/lyrics` | Cognito JWT | Python Lambda | proxies MongoDB doc |
| GET | `/songs/{id}/audio-urls` | Cognito JWT | Python Lambda | pre-signed GET URLs, 15 min TTL |
| WS | `$connect` / `$disconnect` / `$default` | Cognito JWT (query param at connect) | Go Lambda | connection lifecycle + job-status push |
| POST | `/vocab/review` | Cognito JWT | Java Lambda | records a review event, returns next-due date |
| GET | `/vocab/due` | Cognito JWT | Java Lambda | vocab items due today, SM-2 scheduled, queried from DynamoDB |

Everything now sits behind API Gateway directly — HTTP API for REST-style routes, WebSocket API for `/ws`. No ALB, no VPC Link, no separate ingress path: this is the piece that got structurally simpler by dropping EKS, not just cheaper.

### 5.3 ML processing — container and pybind11 detail
Unchanged from v3 — SageMaker Processing Jobs were never part of the EKS/RDS cost problem.

```dockerfile
FROM pytorch/pytorch:2.3.0-cuda12.1-cudnn8-runtime
COPY dsp_core/ /opt/dsp_core/
RUN pip install pybind11 && cd /opt/dsp_core && python setup.py build_ext --inplace
COPY process.py /opt/ml/code/process.py
ENTRYPOINT ["python", "/opt/ml/code/process.py"]
```

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
`ml.g4dn.xlarge` remains the starting instance for Demucs/Whisper; Basic Pitch stays a candidate for a smaller/CPU instance if per-song cost matters more than latency.

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
SONG#{songId}  | METADATA          | title, artist, uploadedBy, status
SONG#{songId}  | JOB#{jobId}       | stage, status, stageOutputs (map of S3 keys)
USER#{userId}  | VOCAB#{vocabId}   | term, definition, easeFactor, intervalDays, repetitions, nextReviewAt, lastReviewedAt

GSI1: GSI1PK=USER#{userId}, GSI1SK=createdAt      -- "my songs, newest first"
GSI2: GSI2PK=USER#{userId}, GSI2SK=nextReviewAt   -- "vocab due today"

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
| Lambda (Python, Rust, Go, Java — all functions) | ~$0-2 | comfortably within the always-free tier at this volume |
| API Gateway (HTTP + WebSocket) | ~$1 | |
| DynamoDB on-demand | ~$1 | job state, song metadata, vocab, WS connections |
| MongoDB Atlas (M0) | $0 | free tier, ample headroom at this scale |
| SageMaker Processing (20-30 songs/month) | ~$2-3 | ~$0.10/song |
| S3 + CloudFront | ~$1-2 | |
| Cognito | $0 | free under 50,000 MAU |
| Route 53 hosted zone | ~$0.50 | |
| **Total** | **~$6-10/month** | |

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

**Phase 1** — plain Python script, no AWS: Demucs → Whisper → Helsinki-NLP → Basic Pitch on one local file.

**Phase 2** — containerize, push to ECR, wire up SageMaker Processing Jobs + the Step Functions ASL from Section 4.

**Phase 3** — API Gateway (HTTP) + Python/Rust Lambda, Cognito, DynamoDB table + GSIs live.

**Phase 4** — React frontend: upload, polling UI, MongoDB-backed player with Web Audio sync.

**Phase 5** — Java Lambda learning service: SM-2 scheduling against DynamoDB, `/vocab/review` and `/vocab/due` endpoints.

**Phase 6** — Go Lambda notification stack: API Gateway WebSocket API, `WebSocketConnections` table, DynamoDB Streams trigger. TensorFlow.js pitch matching in the client. C++ DSP core if Basic Pitch's stock tempo detection proves insufficient.

---

## 11. Open decisions

- Translation granularity: line-by-line vs phrase-level
- Whisper `large-v3` vs `medium` — benchmark before committing
- MongoDB Atlas vs DocumentDB — Atlas first for speed and the free tier; DocumentDB only becomes worth revisiting if this ever moves back inside a VPC for other reasons
- Build the C++ DSP core only if Basic Pitch's output shows a measurable gap
- **New**: plain Java Lambda vs Spring Cloud Function for the learning service — plain Lambda is the leaner, cheaper choice at this scale

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
