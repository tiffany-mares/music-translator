//! POST /songs/{id}/process - upload validation (Phase 3.3, section 5.2).
//!
//! Validation ONLY: size bounds + magic-byte format check on the object under
//! songs/{id}/raw/. The verdict lands on the METADATA item. Deliberately does
//! NOT start Step Functions - the pipeline trigger plus the fingerprint
//! short-circuit are Phases 3.4/3.5. That gap IS the done-when: a malformed
//! upload is rejected before anything downstream can run.

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
            set_status(&ddb, &table, &song_id, "VALIDATED", "audioFormat", format).await?;
            // Phase 3.3 stops here on purpose - no Step Functions start (see module doc).
            json_resp(200, serde_json::json!({ "valid": true, "songId": song_id, "format": format }))
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    run(service_fn(handler)).await
}
