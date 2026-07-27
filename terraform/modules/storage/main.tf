variable "audio_bucket" { type = string }

resource "aws_s3_bucket" "audio" {
  bucket = var.audio_bucket
}

resource "aws_dynamodb_table" "main" {
  name         = "LyraLearnTable"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

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
