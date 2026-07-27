//! POST /songs/{id}/process - upload validation + audio fingerprint dedup
//! (Phase 3.4, section 5.2a).
//!
//! Validation + fingerprint dedup: size bounds + magic-byte format check on the
//! object under songs/{id}/raw/, then chromaprint-based fingerprinting to detect
//! exact duplicates and near-duplicates. Matched songs are LINKED to the original
//! songId with no pipeline run (near-instant dedup). New songs get VALIDATED status
//! and are ready for the pipeline. Deliberately does NOT start Step Functions -
//! that wiring is Phase 3.5.

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

async fn handler(event: Request) -> Result<Response<Body>, Error> {
    let song_id = match event.path_parameters().first("id") {
        Some(id) => id.to_string(),
        None => return json_resp(400, serde_json::json!({ "error": "missing song id" })),
    };

    let config = aws_config::load_from_env().await;
    let s3 = aws_sdk_s3::Client::new(&config);
    let ddb = aws_sdk_dynamodb::Client::new(&config);
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
                    return json_resp(
                        200,
                        serde_json::json!({ "valid": true, "songId": song_id, "format": format }),
                    );
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
                    // Still no Step Functions start - the pass-path wiring is 3.5.
                    json_resp(
                        200,
                        serde_json::json!({ "valid": true, "songId": song_id, "format": format }),
                    )
                }
            }
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    run(service_fn(handler)).await
}
