//! POST /songs/{id}/process - upload validation + audio fingerprint dedup +
//! chunked Step Functions pipeline (Phase 3.4-3.5).
//!
//! Validation + fingerprint dedup: size bounds + magic-byte format check on the
//! object under songs/{id}/raw/, then chromaprint-based fingerprinting to detect
//! exact duplicates and near-duplicates. Matched songs are LINKED to the original
//! songId with no pipeline run (near-instant dedup). New songs get VALIDATED status
//! and start the chunked Step Functions pipeline (Phase 3.5). WebSocket push
//! integration is Phase 6.

mod fingerprint;
mod validation;

use aws_sdk_dynamodb::types::AttributeValue;
use lambda_http::{run, service_fn, Body, Error, Request, RequestExt, Response};

fn json_resp(status: u16, body: serde_json::Value) -> Result<Response<Body>, Error> {
    Ok(Response::builder()
        .status(status)
        .header("Content-Type", "application/json")
        .body(Body::from(body.to_string()))?)
}

async fn set_status(
    ddb: &aws_sdk_dynamodb::Client,
    table: &str,
    song_id: &str,
    status: &str,
    extra_name: &str,
    extra_value: &str,
) -> Result<(), Error> {
    ddb.update_item()
        .table_name(table)
        .key("PK", AttributeValue::S(format!("SONG#{song_id}")))
        .key("SK", AttributeValue::S("METADATA".to_string()))
        .update_expression("SET #s = :s, #x = :x")
        .expression_attribute_names("#s", "status")
        .expression_attribute_names("#x", extra_name)
        .expression_attribute_values(":s", AttributeValue::S(status.to_string()))
        .expression_attribute_values(":x", AttributeValue::S(extra_value.to_string()))
        .send()
        .await?;
    Ok(())
}

async fn reject(
    ddb: &aws_sdk_dynamodb::Client,
    table: &str,
    song_id: &str,
    reason: &str,
) -> Result<Response<Body>, Error> {
    set_status(ddb, table, song_id, "REJECTED", "rejectionReason", reason).await?;
    json_resp(400, serde_json::json!({ "valid": false, "songId": song_id, "reason": reason }))
}

async fn write_validated_with_fp(
    ddb: &aws_sdk_dynamodb::Client,
    table: &str,
    song_id: &str,
    format: &str,
    fp_key: &str,
    fp: &[u32],
) -> Result<(), Error> {
    let seconds = fp.len() as f32 * fingerprint::config().item_duration_in_seconds();
    ddb.update_item()
        .table_name(table)
        .key("PK", AttributeValue::S(format!("SONG#{song_id}")))
        .key("SK", AttributeValue::S("METADATA".to_string()))
        .update_expression(
            "SET #s = :s, audioFormat = :fmt, GSI3PK = :fp, fpFull = :full, fpSeconds = :sec",
        )
        .expression_attribute_names("#s", "status")
        .expression_attribute_values(":s", AttributeValue::S("VALIDATED".into()))
        .expression_attribute_values(":fmt", AttributeValue::S(format.into()))
        .expression_attribute_values(":fp", AttributeValue::S(fp_key.into()))
        .expression_attribute_values(
            ":full",
            AttributeValue::B(aws_sdk_dynamodb::primitives::Blob::new(
                fingerprint::fp_to_bytes(fp),
            )),
        )
        .expression_attribute_values(":sec", AttributeValue::N(format!("{seconds:.1}")))
        .send()
        .await?;
    Ok(())
}

async fn link_to_existing(
    ddb: &aws_sdk_dynamodb::Client,
    table: &str,
    song_id: &str,
    format: &str,
    orig_id: &str,
    orig_audio_keys: Option<&AttributeValue>,
) -> Result<(), Error> {
    // LINKED items intentionally get NO GSI3PK: the index stays canonical
    // (one item per fingerprint), so future queries always find the original
    // and links can never chain. audioKeys is copied only when the original
    // has it (pre-3.5 songs mostly don't).
    let mut update = ddb
        .update_item()
        .table_name(table)
        .key("PK", AttributeValue::S(format!("SONG#{song_id}")))
        .key("SK", AttributeValue::S("METADATA".to_string()))
        .expression_attribute_names("#s", "status")
        .expression_attribute_values(":s", AttributeValue::S("LINKED".into()))
        .expression_attribute_values(":fmt", AttributeValue::S(format.into()))
        .expression_attribute_values(":orig", AttributeValue::S(orig_id.into()));
    let expr = match orig_audio_keys {
        Some(keys) => {
            update = update.expression_attribute_values(":keys", keys.clone());
            "SET #s = :s, audioFormat = :fmt, linkedSongId = :orig, audioKeys = :keys"
        }
        None => "SET #s = :s, audioFormat = :fmt, linkedSongId = :orig",
    };
    update.update_expression(expr).send().await?;
    Ok(())
}

/// 12 hex chars of a v4 UUID: dot-free (the composite jobId "{songId}.{jobKey}"
/// splits on the LAST dot), valid as an SFN execution name and inside SageMaker
/// job names, and 48 bits of entropy - ample uniqueness at this scale.
fn mint_job_key() -> String {
    uuid::Uuid::new_v4().simple().to_string()[..12].to_string()
}

/// Mint the jobKey, pre-write the JOB# item as QUEUED, start the chunked state
/// machine. Returns the composite jobId "{songId}.{jobKey}".
///
/// QUEUED is written BEFORE StartExecution so GET /jobs/{jobId} resolves the
/// moment the client has the jobId, and so this write can never land after
/// (and clobber) the machine's own MarkProcessing update. The SFN input takes
/// the BARE jobKey - the ASL formats SK as JOB#{jobId} itself.
async fn start_pipeline(
    sfn: &aws_sdk_sfn::Client,
    ddb: &aws_sdk_dynamodb::Client,
    table: &str,
    song_id: &str,
) -> Result<String, Error> {
    let arn = std::env::var("STATE_MACHINE_ARN")
        .map_err(|_| Error::from("STATE_MACHINE_ARN not set"))?;
    let job_key = mint_job_key();

    ddb.update_item()
        .table_name(table)
        .key("PK", AttributeValue::S(format!("SONG#{song_id}")))
        .key("SK", AttributeValue::S(format!("JOB#{job_key}")))
        .update_expression("SET #s = :s")
        .expression_attribute_names("#s", "status")
        .expression_attribute_values(":s", AttributeValue::S("QUEUED".into()))
        .send()
        .await?;

    // Execution name == jobKey: unique per start (deterministic names
    // self-collide on retry - notes/phase2.md 2.3), threads into S3 prefixes
    // and SageMaker job names ("lyralearn-sfn-{jobKey}-chunk-NNN", 36 < 63).
    let started = sfn
        .start_execution()
        .state_machine_arn(&arn)
        .name(&job_key)
        .input(serde_json::json!({ "songId": song_id, "jobId": job_key }).to_string())
        .send()
        .await;

    if let Err(e) = started {
        // Best-effort tombstone so the QUEUED item can't dangle forever.
        let _ = ddb
            .update_item()
            .table_name(table)
            .key("PK", AttributeValue::S(format!("SONG#{song_id}")))
            .key("SK", AttributeValue::S(format!("JOB#{job_key}")))
            .update_expression("SET #s = :s, errorInfo = :e")
            .expression_attribute_names("#s", "status")
            .expression_attribute_values(":s", AttributeValue::S("FAILED".into()))
            .expression_attribute_values(":e", AttributeValue::S(format!("StartExecution failed: {e}")))
            .send()
            .await;
        return Err(Error::from(format!("StartExecution failed: {e}")));
    }
    Ok(format!("{song_id}.{job_key}"))
}

/// Both VALIDATED-new exits (clean miss and decode-degrade) share this: the
/// song IS validated either way, so a pipeline-start failure reports 500 with
/// valid=true and leaves METADATA VALIDATED - a retried POST /process mints a
/// fresh jobKey and execution.
async fn respond_validated_with_pipeline(
    sfn: &aws_sdk_sfn::Client,
    ddb: &aws_sdk_dynamodb::Client,
    table: &str,
    song_id: &str,
    format: &str,
) -> Result<Response<Body>, Error> {
    match start_pipeline(sfn, ddb, table, song_id).await {
        Ok(job_id) => json_resp(
            200,
            serde_json::json!({ "valid": true, "songId": song_id, "format": format, "jobId": job_id }),
        ),
        Err(e) => {
            eprintln!("pipeline start failed for {song_id}: {e}");
            json_resp(
                500,
                serde_json::json!({
                    "valid": true, "songId": song_id, "format": format,
                    "error": "validated but the pipeline failed to start; retry POST /songs/{id}/process"
                }),
            )
        }
    }
}

async fn handler(event: Request) -> Result<Response<Body>, Error> {
    let song_id = match event.path_parameters().first("id") {
        Some(id) => id.to_string(),
        None => return json_resp(400, serde_json::json!({ "error": "missing song id" })),
    };

    let config = aws_config::load_from_env().await;
    let s3 = aws_sdk_s3::Client::new(&config);
    let ddb = aws_sdk_dynamodb::Client::new(&config);
    let sfn = aws_sdk_sfn::Client::new(&config);
    let bucket = std::env::var("AUDIO_BUCKET").expect("AUDIO_BUCKET not set");
    let table = std::env::var("TABLE_NAME").unwrap_or_else(|_| "LyraLearnTable".to_string());

    let prefix = format!("songs/{song_id}/raw/");
    let listed = s3.list_objects_v2().bucket(&bucket).prefix(&prefix).send().await?;
    let object = listed
        .contents()
        .iter()
        .find(|o| o.size().unwrap_or(0) > 0)
        .cloned();
    let Some(object) = object else {
        return reject(&ddb, &table, &song_id, "no uploaded file found").await;
    };
    let key = object.key().unwrap_or_default().to_string();
    let size = object.size().unwrap_or(0);

    // Lifecycle targeting: keys are songs/{songId}/raw/... so no S3 prefix
    // rule can select raw/ across songs - the tier=raw tag is what the
    // 30-day -> STANDARD_IA transition filters on (terraform storage module).
    // Best-effort: a tagging failure must never block validation.
    let tagged = async {
        let tag = aws_sdk_s3::types::Tag::builder().key("tier").value("raw").build()?;
        let tagging = aws_sdk_s3::types::Tagging::builder().tag_set(tag).build()?;
        s3.put_object_tagging().bucket(&bucket).key(&key).tagging(tagging).send().await?;
        Ok::<(), Error>(())
    }
    .await;
    if let Err(e) = tagged {
        eprintln!("tier=raw tagging failed for {key} (IA transition will not apply): {e}");
    }

    if let Err(reason) = validation::validate_size(size) {
        return reject(&ddb, &table, &song_id, &reason).await;
    }

    let ranged = s3
        .get_object()
        .bucket(&bucket)
        .key(&key)
        .range("bytes=0-11")
        .send()
        .await?;
    let header = ranged.body.collect().await?.into_bytes();

    match validation::detect_format(&header) {
        Err(reason) => reject(&ddb, &table, &song_id, &reason).await,
        Ok(format) => {
            // Full object for decode+fingerprint - the 12-byte ranged GET above has
            // already rejected garbage before this download (25 MB max via validate_size).
            let full = s3.get_object().bucket(&bucket).key(&key).send().await?;
            let bytes = full.body.collect().await?.to_vec();

            // fingerprint_bytes touches no shared state (pure function over the
            // owned `bytes`/`format` args), so AssertUnwindSafe is sound here.
            // symphonia can panic on adversarial/unusual input (e.g.
            // SampleBuffer::copy_interleaved_ref asserts if a later packet's spec
            // is larger than the one the buffer was sized from - real-world
            // stitched mono->stereo mp3s hit this). A panic must degrade the same
            // way a decode Err does, not surface as a Lambda 500.
            let fp_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                fingerprint::fingerprint_bytes(bytes, format)
            }))
            .unwrap_or_else(|_| Err("fingerprint computation panicked".to_string()));

            let fp = match fp_result {
                Ok(fp) => fp,
                Err(e) => {
                    // Decode failure on a format-validated file (HE-AAC m4a, Ogg
                    // Opus): degrade to 3.3 behavior, never reject a playable upload.
                    eprintln!("fingerprint failed for {song_id}, skipping dedup: {e}");
                    set_status(&ddb, &table, &song_id, "VALIDATED", "audioFormat", format).await?;
                    return respond_validated_with_pipeline(&sfn, &ddb, &table, &song_id, format).await;
                }
            };

            let fp_key = fingerprint::gsi3_key(&fp);
            let q = ddb
                .query()
                .table_name(&table)
                .index_name("GSI3")
                .key_condition_expression("GSI3PK = :fp")
                .expression_attribute_values(":fp", AttributeValue::S(fp_key.clone()))
                .send()
                .await?;

            // Candidates share the simhash key; verify acoustically. PK != self keeps
            // reprocessing idempotent (a song must never LINK to itself).
            let me = format!("SONG#{song_id}");
            let dup = q.items().iter().find(|item| {
                item.get("PK").and_then(|v| v.as_s().ok()).is_some_and(|pk| *pk != me)
                    && item.get("fpFull").and_then(|v| v.as_b().ok()).is_some_and(|blob| {
                        fingerprint::is_duplicate(&fp, &fingerprint::fp_from_bytes(blob.as_ref()))
                    })
            });

            match dup {
                Some(orig) => {
                    let orig_id = orig
                        .get("PK")
                        .and_then(|v| v.as_s().ok())
                        .and_then(|pk| pk.strip_prefix("SONG#"))
                        .unwrap_or_default()
                        .to_string();
                    link_to_existing(&ddb, &table, &song_id, format, &orig_id, orig.get("audioKeys"))
                        .await?;
                    // Section 5.2a short-circuit: linked, and (come 3.5) no pipeline.
                    json_resp(
                        200,
                        serde_json::json!({ "valid": true, "songId": song_id, "linkedSongId": orig_id, "format": format }),
                    )
                }
                None => {
                    write_validated_with_fp(&ddb, &table, &song_id, format, &fp_key, &fp).await?;
                    respond_validated_with_pipeline(&sfn, &ddb, &table, &song_id, format).await
                }
            }
        }
    }
}

#[cfg(test)]
mod job_key_tests {
    #[test]
    fn job_key_is_short_dotless_and_unique() {
        let k = super::mint_job_key();
        assert_eq!(k.len(), 12);
        assert!(k.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(k, super::mint_job_key());
    }
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    run(service_fn(handler)).await
}
