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
