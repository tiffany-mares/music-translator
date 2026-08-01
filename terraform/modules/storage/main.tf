variable "audio_bucket" { type = string }
variable "frontend_origin" { type = string } # https://dxxxx.cloudfront.net

resource "aws_s3_bucket" "audio" {
  bucket = var.audio_bucket
}

# Spec §3: versioned. Overwrites/deletes keep noncurrent versions; the
# lifecycle rule below expires those after 30 days so versioning can't grow
# storage unboundedly.
resource "aws_s3_bucket_versioning" "audio" {
  bucket = aws_s3_bucket.audio.id
  versioning_configuration {
    status = "Enabled"
  }
}

# Spec §3/§5.4/§9: SSE-S3. AWS has defaulted new buckets to AES256 since
# Jan 2023, but the spec calls it out explicitly — configure it rather than
# rely on the default.
resource "aws_s3_bucket_server_side_encryption_configuration" "audio" {
  bucket = aws_s3_bucket.audio.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Spec §5.4: raw/ -> Standard-IA after 30 days (stems/pitch stay Standard —
# they're read on every playback). Keys are songs/{songId}/raw/... so no
# prefix can select raw/ across songs; the validate Lambda tags each raw
# object tier=raw at /process time and the rule filters on that tag.
resource "aws_s3_bucket_lifecycle_configuration" "audio" {
  bucket = aws_s3_bucket.audio.id

  rule {
    id     = "raw-to-ia"
    status = "Enabled"
    filter {
      tag {
        key   = "tier"
        value = "raw"
      }
    }
    transition {
      days          = 30
      storage_class = "STANDARD_IA"
    }
  }

  rule {
    id     = "expire-noncurrent"
    status = "Enabled"
    filter {} # whole bucket
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

# Browsers preflight the presigned PUT (curl never did, which is why phases
# 3.x passed without this). Without CORS the OPTIONS returns 403 and no
# browser upload can succeed.
resource "aws_s3_bucket_cors_configuration" "audio" {
  bucket = aws_s3_bucket.audio.id

  cors_rule {
    allowed_methods = ["PUT"]
    allowed_origins = [var.frontend_origin, "http://localhost:5173"]
    allowed_headers = ["*"]
    max_age_seconds = 3600
  }
}

resource "aws_dynamodb_table" "main" {
  name         = "LyraLearnTable"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  # Phase 6.2: job-status pushes. NEW_IMAGE only - the push handler never
  # needs the old image. Enabling on the existing table is an in-place update.
  stream_enabled   = true
  stream_view_type = "NEW_IMAGE"

  dynamic "attribute" {
    for_each = toset(["PK", "SK", "GSI1PK", "GSI1SK", "GSI2PK", "GSI2SK", "GSI3PK"])
    content {
      name = attribute.value
      type = "S"
    }
  }

  global_secondary_index {
    name            = "GSI1"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL"
  }
  global_secondary_index {
    name            = "GSI2"
    hash_key        = "GSI2PK"
    range_key       = "GSI2SK"
    projection_type = "ALL"
  }
  global_secondary_index {
    name            = "GSI3"
    hash_key        = "GSI3PK"
    projection_type = "ALL"
  }
}

resource "aws_dynamodb_table" "ws_connections" {
  name         = "WebSocketConnections"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "connectionId"

  attribute {
    name = "connectionId"
    type = "S"
  }
  attribute {
    name = "userId"
    type = "S"
  }

  global_secondary_index {
    name            = "GSI1"
    hash_key        = "userId"
    projection_type = "ALL"
  }
}

# Phase 3.5: MongoDB Atlas connection string. Terraform manages the SHELL only;
# the value is set out-of-band with `aws secretsmanager put-secret-value` so
# the credential never enters TF state.
resource "aws_secretsmanager_secret" "mongodb" {
  name        = "lyralearn/mongodb"
  description = "MongoDB Atlas connection string (value set out-of-band, never in TF state)"
}

output "mongodb_secret_arn" { value = aws_secretsmanager_secret.mongodb.arn }
output "lyralearn_table_stream_arn" { value = aws_dynamodb_table.main.stream_arn }
