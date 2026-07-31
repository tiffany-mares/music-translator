# Cognito is the single identity source (architecture.md section 9). The API
# Gateway JWT authorizer that consumes these tokens arrives with the HTTP API
# in 3.2; jwt_issuer + client id outputs below are its configuration.

resource "aws_cognito_user_pool" "users" {
  name = "lyralearn-users"

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  password_policy {
    minimum_length    = 12
    require_lowercase = true
    require_numbers   = true
    require_symbols   = false
    require_uppercase = true
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }
}

resource "aws_cognito_user_pool_client" "web" {
  name         = "lyralearn-web"
  user_pool_id = aws_cognito_user_pool.users.id

  # Public SPA client - no secret (generate_secret defaults to false; left
  # implicit because an imported client reports it as null and an explicit
  # false forces pointless replacement). ADMIN_USER_PASSWORD_AUTH is for
  # server-side test-JWT issuance (3.1 done-when + 3.2 Postman); SRP is the
  # browser flow.
  explicit_auth_flows = [
    "ALLOW_ADMIN_USER_PASSWORD_AUTH",
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  access_token_validity  = 1
  id_token_validity      = 1
  refresh_token_validity = 30
  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }
}

output "user_pool_id" { value = aws_cognito_user_pool.users.id }
output "user_pool_client_id" { value = aws_cognito_user_pool_client.web.id }
output "jwt_issuer" {
  value = "https://cognito-idp.us-east-1.amazonaws.com/${aws_cognito_user_pool.users.id}"
}

# ---- Phase 3.2: HTTP API + JWT authorizer + the core Python routes Lambda ----

variable "region" { type = string }
variable "account_id" { type = string }
variable "audio_bucket" { type = string }
variable "chunked_state_machine_arn" { type = string }
variable "mongodb_secret_arn" { type = string }
variable "frontend_origin" { type = string } # https://dxxxx.cloudfront.net

data "archive_file" "api_lambda" {
  type        = "zip"
  source_dir  = "${path.module}/../../../lambda/api"
  output_path = "${path.module}/api_lambda.zip"
}

# Phase 3.5: pymongo layer - bson is a C extension, built inside the matching
# Lambda runtime image by scripts/build_api_layer.sh (zip is gitignored,
# rebuild before plan; hash change republishes the layer version).
resource "aws_lambda_layer_version" "api_deps" {
  layer_name          = "lyralearn-api-deps"
  filename            = "${path.module}/../../../lambda/api-layer/api-deps-layer.zip"
  source_code_hash    = filebase64sha256("${path.module}/../../../lambda/api-layer/api-deps-layer.zip")
  compatible_runtimes = ["python3.12"]
}

resource "aws_iam_role" "api" {
  name               = "lyralearn-lambda-api"
  assume_role_policy = file("${path.module}/../../../infra/aws/lambda-trust.json")
}

resource "aws_iam_role_policy" "api" {
  name = "lyralearn-api-scoped"
  role = aws_iam_role.api.id
  policy = replace(replace(replace(
    file("${path.module}/../../../infra/aws/lambda-api-policy.json"),
  "__BUCKET__", var.audio_bucket), "__REGION__", var.region), "__ACCOUNT_ID__", var.account_id)
}

resource "aws_lambda_function" "api" {
  function_name    = "lyralearn-api"
  runtime          = "python3.12"
  handler          = "handler.handler"
  filename         = data.archive_file.api_lambda.output_path
  source_code_hash = data.archive_file.api_lambda.output_base64sha256
  role             = aws_iam_role.api.arn
  timeout          = 10
  memory_size      = 256
  layers           = [aws_lambda_layer_version.api_deps.arn]

  environment {
    variables = {
      AUDIO_BUCKET         = var.audio_bucket
      MONGODB_SECRET_ARN   = var.mongodb_secret_arn
    }
  }
}

resource "aws_apigatewayv2_api" "http" {
  name          = "lyralearn-http-api"
  protocol_type = "HTTP"

  # HTTP APIs answer OPTIONS preflights before the JWT authorizer when
  # cors_configuration is present — no auth on preflight, which is what
  # browsers need. Origins are exact-match: no trailing slash.
  cors_configuration {
    allow_origins = [var.frontend_origin, "http://localhost:5173"]
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_headers = ["authorization", "content-type"]
    max_age       = 3600
  }
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.http.id
  name             = "cognito-jwt"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]

  jwt_configuration {
    audience = [aws_cognito_user_pool_client.web.id]
    issuer   = "https://cognito-idp.us-east-1.amazonaws.com/${aws_cognito_user_pool.users.id}"
  }
}

resource "aws_apigatewayv2_integration" "api_lambda" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "routes" {
  for_each = toset([
    "POST /songs",
    "GET /jobs/{id}",
    "GET /songs/{id}/lyrics",
    "GET /songs/{id}/audio-urls",
  ])
  api_id             = aws_apigatewayv2_api.http.id
  route_key          = each.key
  target             = "integrations/${aws_apigatewayv2_integration.api_lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowHttpApiInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}

output "api_endpoint" { value = aws_apigatewayv2_api.http.api_endpoint }

# ---- Phase 3.3: Rust validation Lambda on POST /songs/{id}/process ----

resource "aws_iam_role" "validate" {
  name               = "lyralearn-lambda-validate"
  assume_role_policy = file("${path.module}/../../../infra/aws/lambda-trust.json")
}

resource "aws_iam_role_policy" "validate" {
  name = "lyralearn-validate-scoped"
  role = aws_iam_role.validate.id
  policy = replace(replace(replace(
    file("${path.module}/../../../infra/aws/lambda-validate-policy.json"),
  "__BUCKET__", var.audio_bucket), "__REGION__", var.region), "__ACCOUNT_ID__", var.account_id)
}

resource "aws_lambda_function" "validate" {
  function_name    = "lyralearn-validate"
  runtime          = "provided.al2023"
  handler          = "bootstrap"
  filename         = "${path.module}/../../../lambda/validate/target/lambda/bootstrap/bootstrap.zip"
  source_code_hash = filebase64sha256("${path.module}/../../../lambda/validate/target/lambda/bootstrap/bootstrap.zip")
  role             = aws_iam_role.validate.arn
  timeout          = 30   # decode+fingerprint headroom (API GW caps responses at 29s anyway)
  memory_size      = 1024 # ~0.57 vCPU; at 128 MB (0.08 vCPU) the audio decode would take minutes

  environment {
    variables = {
      AUDIO_BUCKET      = var.audio_bucket
      STATE_MACHINE_ARN = var.chunked_state_machine_arn
    }
  }
}

resource "aws_apigatewayv2_integration" "validate_lambda" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.validate.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "process" {
  api_id             = aws_apigatewayv2_api.http.id
  route_key          = "POST /songs/{id}/process"
  target             = "integrations/${aws_apigatewayv2_integration.validate_lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_lambda_permission" "apigw_validate" {
  statement_id  = "AllowHttpApiInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.validate.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}

# ---- Phase 5.1: Java learning Lambda skeleton on the /vocab routes ----
# Deploy = scripts/build_learning_lambda.sh first, then terraform (the jar
# hash below flows into the plan). Stub answers 501 until 5.3.

resource "aws_iam_role" "learning" {
  name               = "lyralearn-lambda-learning"
  assume_role_policy = file("${path.module}/../../../infra/aws/lambda-trust.json")
}

# Deliberate slight over-grant vs the empty stub: the policy already carries the
# full Phase-5 charter (Get/Put/UpdateItem on the table + Query on GSI2) so 5.3
# ships with zero additional IAM applies. The stub itself never calls DynamoDB.
resource "aws_iam_role_policy" "learning" {
  name = "lyralearn-learning-scoped"
  role = aws_iam_role.learning.id
  policy = replace(replace(
    file("${path.module}/../../../infra/aws/lambda-learning-policy.json"),
  "__REGION__", var.region), "__ACCOUNT_ID__", var.account_id)
}

resource "aws_lambda_function" "learning" {
  function_name    = "lyralearn-learning"
  runtime          = "java21"
  handler          = "com.lyralearn.learning.Handler::handleRequest"
  filename         = "${path.module}/../../../lambda/learning/target/learning-lambda.jar"
  source_code_hash = filebase64sha256("${path.module}/../../../lambda/learning/target/learning-lambda.jar")
  role             = aws_iam_role.learning.arn
  timeout          = 10
  memory_size      = 512 # JVM cold-start headroom; revisit after 5.3 has real latency numbers
}

resource "aws_apigatewayv2_integration" "learning_lambda" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.learning.invoke_arn
  payload_format_version = "2.0"
}

# Both Phase-5 routes wired to the stub now: proves "deployed and reachable";
# 5.3 swaps in the real handlers with no route changes. CORS already allows
# GET/POST - untouched.
resource "aws_apigatewayv2_route" "vocab" {
  for_each = toset([
    "POST /vocab/review",
    "GET /vocab/due",
  ])
  api_id             = aws_apigatewayv2_api.http.id
  route_key          = each.key
  target             = "integrations/${aws_apigatewayv2_integration.learning_lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_lambda_permission" "apigw_learning" {
  statement_id  = "AllowHttpApiInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.learning.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}
