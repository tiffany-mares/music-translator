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

data "archive_file" "api_lambda" {
  type        = "zip"
  source_dir  = "${path.module}/../../../lambda/api"
  output_path = "${path.module}/api_lambda.zip"
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

  environment {
    variables = {
      AUDIO_BUCKET = var.audio_bucket
    }
  }
}

resource "aws_apigatewayv2_api" "http" {
  name          = "lyralearn-http-api"
  protocol_type = "HTTP"
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
