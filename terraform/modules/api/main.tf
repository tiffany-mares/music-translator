# Cognito is the single identity source (architecture.md section 9). The API
# Gateway JWT authorizer that consumes these tokens arrives with the HTTP API
# in 3.2; jwt_issuer + client id outputs below are its configuration.

resource "aws_cognito_user_pool" "users" {
  name = "lyralearn-users"

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  password_policy {
    minimum_length    = 8 # user decision 2026-08-02 (was 12)
    require_lowercase = true
    require_numbers   = true
    require_symbols   = false
    require_uppercase = true
  }

  # No email-verification step (user decision 2026-08-02): the pre-sign-up
  # trigger auto-confirms every account and marks the email verified.
  lambda_config {
    pre_sign_up = aws_lambda_function.autoconfirm.arn
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  # Forgot-password email (signup verification no longer sends mail - the
  # pre-sign-up trigger auto-confirms - so this template is solely the reset
  # email). Carries a LINK to the reset page with the code embedded.
  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
    email_subject        = "Reset your Cadenza password"
    email_message        = "Someone requested a password reset for your Cadenza account. Reset it here: ${var.frontend_origin}/reset-password?code={####} — or enter the code {####} on the reset page. If this wasn't you, ignore this email."
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

  # Google federation (glass-card follow-up). The Google IdP itself is created
  # OUT-OF-BAND (aws cognito-idp create-identity-provider) so its client
  # secret never enters TF state - mirroring the lyralearn/mongodb pattern.
  # supported_identity_providers therefore lists Google only after that CLI
  # step has run (var.google_idp_enabled flips post-creation).
  supported_identity_providers = var.google_idp_enabled ? ["COGNITO", "Google"] : ["COGNITO"]

  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  callback_urls                        = [var.frontend_origin, "http://localhost:5173"]
  logout_urls                          = [var.frontend_origin, "http://localhost:5173"]
}

variable "google_idp_enabled" {
  type    = bool
  default = true # flipped 2026-08-01: the Google IdP was created out-of-band via CLI
}

# Hosted-UI domain: the OAuth code flow needs one; Google's authorized
# redirect URI is https://<this domain>/oauth2/idpresponse.
resource "aws_cognito_user_pool_domain" "hosted" {
  domain       = "cadenza-${var.account_id}"
  user_pool_id = aws_cognito_user_pool.users.id
}

output "hosted_ui_domain" {
  value = "${aws_cognito_user_pool_domain.hosted.domain}.auth.${var.region}.amazoncognito.com"
}

# ---- pre-sign-up auto-confirm trigger (no email verification) ----
data "archive_file" "autoconfirm_lambda" {
  type        = "zip"
  source_file = "${path.module}/../../../lambda/auto_confirm/handler.py"
  output_path = "${path.module}/../../../lambda/auto_confirm/autoconfirm.zip"
}

resource "aws_iam_role" "autoconfirm" {
  name = "lyralearn-lambda-autoconfirm"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "sts:AssumeRole",
    Principal = { Service = "lambda.amazonaws.com" } }]
  })
}

resource "aws_iam_role_policy" "autoconfirm" {
  name = "lyralearn-autoconfirm-scoped"
  role = aws_iam_role.autoconfirm.id
  policy = replace(replace(file("${path.module}/../../../infra/aws/lambda-autoconfirm-policy.json"),
  "__REGION__", var.region), "__ACCOUNT_ID__", var.account_id)
}

resource "aws_lambda_function" "autoconfirm" {
  function_name    = "lyralearn-autoconfirm"
  role             = aws_iam_role.autoconfirm.arn
  runtime          = "python3.12"
  handler          = "handler.handler"
  filename         = data.archive_file.autoconfirm_lambda.output_path
  source_code_hash = data.archive_file.autoconfirm_lambda.output_base64sha256
  timeout          = 5
}

resource "aws_lambda_permission" "cognito_autoconfirm" {
  statement_id  = "AllowCognitoInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.autoconfirm.function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = aws_cognito_user_pool.users.arn
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
    allow_methods = ["GET", "POST", "PUT", "OPTIONS"] # PUT: /profile
    allow_headers = ["authorization", "content-type"]
    max_age       = 3600
  }
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true

  # Phase 7: the listen/upload path is public (anonymous uploads trigger paid
  # GPU processing), so cap the request rate stage-wide. Modest numbers - the
  # app's own polling is 1 req/15-60s per client.
  default_route_settings {
    throttling_rate_limit  = 10
    throttling_burst_limit = 20
  }
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

# Phase 7 (user decision): the whole listen/upload path is PUBLIC - browse,
# play, and upload need no account. Only /vocab/* keeps the JWT authorizer.
resource "aws_apigatewayv2_route" "routes" {
  for_each = toset([
    "POST /songs",
    "GET /songs",
    "GET /jobs/{id}",
    "GET /songs/{id}/lyrics",
    "GET /songs/{id}/audio-urls",
  ])
  api_id             = aws_apigatewayv2_api.http.id
  route_key          = each.key
  target             = "integrations/${aws_apigatewayv2_integration.api_lambda.id}"
  authorization_type = "NONE"
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
  # Public (Phase 7): the validate lambda reads no claims - it works off songId.
  authorization_type = "NONE"
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
  timeout          = 15  # 5.4: cold quiz = JVM start + secret fetch + Atlas SRV/TLS + query; 10s was sized for DynamoDB-only
  memory_size      = 512 # JVM cold-start headroom; revisit after 5.3 has real latency numbers

  environment {
    variables = {
      MONGODB_SECRET_ARN = var.mongodb_secret_arn
    }
  }
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
    "GET /vocab/quiz",
    "GET /vocab",
    "GET /profile",
    "PUT /profile",
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

# ---- Phase 6.1: WebSocket API + Go $connect/$disconnect Lambdas ----
# Build = scripts/build_ws_lambda.sh first (zips must exist before plan - the
# hashes below flow into it). Auth is in-handler: WebSocket APIs cannot use
# the HTTP JWT authorizer, so the connect Lambda validates the same Cognito
# ID token (query param `token`, same issuer/audience) per architecture.md §9.
# No $default route yet - no client->server messages exist until 6.2/6.3.

resource "aws_iam_role" "ws_connect" {
  name               = "lyralearn-lambda-ws-connect"
  assume_role_policy = file("${path.module}/../../../infra/aws/lambda-trust.json")
}

resource "aws_iam_role_policy" "ws_connect" {
  name = "lyralearn-ws-connect-scoped"
  role = aws_iam_role.ws_connect.id
  policy = replace(replace(
    file("${path.module}/../../../infra/aws/lambda-ws-connect-policy.json"),
  "__REGION__", var.region), "__ACCOUNT_ID__", var.account_id)
}

resource "aws_iam_role" "ws_disconnect" {
  name               = "lyralearn-lambda-ws-disconnect"
  assume_role_policy = file("${path.module}/../../../infra/aws/lambda-trust.json")
}

resource "aws_iam_role_policy" "ws_disconnect" {
  name = "lyralearn-ws-disconnect-scoped"
  role = aws_iam_role.ws_disconnect.id
  policy = replace(replace(
    file("${path.module}/../../../infra/aws/lambda-ws-disconnect-policy.json"),
  "__REGION__", var.region), "__ACCOUNT_ID__", var.account_id)
}

resource "aws_lambda_function" "ws_connect" {
  function_name    = "lyralearn-ws-connect"
  runtime          = "provided.al2023"
  handler          = "bootstrap"
  filename         = "${path.module}/../../../lambda/ws/dist/connect.zip"
  source_code_hash = filebase64sha256("${path.module}/../../../lambda/ws/dist/connect.zip")
  role             = aws_iam_role.ws_connect.arn
  timeout          = 10
  memory_size      = 128 # Go: ms cold starts, one PutItem - smallest tier is plenty

  environment {
    variables = {
      TABLE_NAME     = "WebSocketConnections"
      COGNITO_ISSUER = "https://cognito-idp.us-east-1.amazonaws.com/${aws_cognito_user_pool.users.id}"
      CLIENT_ID      = aws_cognito_user_pool_client.web.id
    }
  }
}

resource "aws_lambda_function" "ws_disconnect" {
  function_name    = "lyralearn-ws-disconnect"
  runtime          = "provided.al2023"
  handler          = "bootstrap"
  filename         = "${path.module}/../../../lambda/ws/dist/disconnect.zip"
  source_code_hash = filebase64sha256("${path.module}/../../../lambda/ws/dist/disconnect.zip")
  role             = aws_iam_role.ws_disconnect.arn
  timeout          = 10
  memory_size      = 128

  environment {
    variables = {
      TABLE_NAME = "WebSocketConnections"
    }
  }
}

resource "aws_apigatewayv2_api" "ws" {
  name                       = "lyralearn-ws-api"
  protocol_type              = "WEBSOCKET"
  route_selection_expression = "$request.body.action"
}

# WebSocket integrations are 1.0-only: no payload_format_version here.
resource "aws_apigatewayv2_integration" "ws_connect" {
  api_id           = aws_apigatewayv2_api.ws.id
  integration_type = "AWS_PROXY"
  integration_uri  = aws_lambda_function.ws_connect.invoke_arn
}

resource "aws_apigatewayv2_integration" "ws_disconnect" {
  api_id           = aws_apigatewayv2_api.ws.id
  integration_type = "AWS_PROXY"
  integration_uri  = aws_lambda_function.ws_disconnect.invoke_arn
}

resource "aws_apigatewayv2_route" "ws_connect" {
  api_id    = aws_apigatewayv2_api.ws.id
  route_key = "$connect"
  target    = "integrations/${aws_apigatewayv2_integration.ws_connect.id}"
}

resource "aws_apigatewayv2_route" "ws_disconnect" {
  api_id    = aws_apigatewayv2_api.ws.id
  route_key = "$disconnect"
  target    = "integrations/${aws_apigatewayv2_integration.ws_disconnect.id}"
}

# WebSocket APIs reject the special "$default" stage name (HTTP-API-only);
# the stage name is a path segment in the wss URL.
resource "aws_apigatewayv2_stage" "ws" {
  api_id      = aws_apigatewayv2_api.ws.id
  name        = "prod"
  auto_deploy = true
}

resource "aws_lambda_permission" "ws_connect" {
  statement_id  = "AllowWsApiInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ws_connect.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.ws.execution_arn}/*/*"
}

resource "aws_lambda_permission" "ws_disconnect" {
  statement_id  = "AllowWsApiInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ws_disconnect.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.ws.execution_arn}/*/*"
}

output "ws_endpoint" { value = aws_apigatewayv2_stage.ws.invoke_url }

# ---- Phase 6.2: DynamoDB Streams -> Go push Lambda -> PostToConnection ----
# Job items carry no userId (schema §6.1), so the handler resolves the owner
# via SONG#{songId}/METADATA.uploadedBy, then fans out to every GSI1
# connection - both documented deviations from §5.6 (notes/phase6.md §6.2).
# No aws_lambda_permission: Lambda POLLS the stream (event source mapping);
# the function role below carries the stream-read grant instead.

variable "lyralearn_table_stream_arn" { type = string }

resource "aws_iam_role" "ws_push" {
  name               = "lyralearn-lambda-ws-push"
  assume_role_policy = file("${path.module}/../../../infra/aws/lambda-trust.json")
}

resource "aws_iam_role_policy" "ws_push" {
  name = "lyralearn-ws-push-scoped"
  role = aws_iam_role.ws_push.id
  policy = replace(replace(replace(
    file("${path.module}/../../../infra/aws/lambda-ws-push-policy.json"),
  "__WS_API_ID__", aws_apigatewayv2_api.ws.id), "__REGION__", var.region), "__ACCOUNT_ID__", var.account_id)
}

resource "aws_lambda_function" "ws_push" {
  function_name    = "lyralearn-ws-push"
  runtime          = "provided.al2023"
  handler          = "bootstrap"
  filename         = "${path.module}/../../../lambda/ws/dist/push.zip"
  source_code_hash = filebase64sha256("${path.module}/../../../lambda/ws/dist/push.zip")
  role             = aws_iam_role.ws_push.arn
  timeout          = 30  # worst-case batch fan-out; typical record is <100ms
  memory_size      = 128 # Go: one GetItem + one Query + a few HTTP POSTs

  environment {
    variables = {
      LYRALEARN_TABLE   = "LyraLearnTable"
      CONNECTIONS_TABLE = "WebSocketConnections"
      # PostToConnection management endpoint is https (not wss) at the stage path.
      WS_MANAGEMENT_ENDPOINT = "https://${aws_apigatewayv2_api.ws.id}.execute-api.${var.region}.amazonaws.com/prod"
    }
  }
}

resource "aws_lambda_event_source_mapping" "ws_push" {
  event_source_arn                   = var.lyralearn_table_stream_arn
  function_name                      = aws_lambda_function.ws_push.arn
  starting_position                  = "LATEST"
  maximum_batching_window_in_seconds = 0 # push latency is the whole point

  # Server-side filter: the Lambda only ever invokes for job-item MODIFYs.
  # VOCAB#/METADATA/etc. writes on the same stream never reach it. The same
  # predicate is enforced (and unit-tested) in-code as belt and braces.
  filter_criteria {
    filter {
      pattern = jsonencode({
        eventName = ["MODIFY"]
        dynamodb  = { Keys = { SK = { S = [{ prefix = "JOB#" }] } } }
      })
    }
  }
}
