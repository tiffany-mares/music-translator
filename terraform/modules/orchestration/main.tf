variable "region" { type = string }
variable "account_id" { type = string }
variable "audio_bucket" { type = string }
variable "chunked_max_concurrency" { type = number }
variable "sagemaker_role_arn" { type = string }
variable "mongodb_secret_arn" { type = string }

locals {
  infra        = "${path.module}/../../../infra/aws"
  lambda_trust = file("${local.infra}/lambda-trust.json")

  fill = { B = var.audio_bucket, R = var.region, A = var.account_id }
}

# ---- Lambda roles + scoped policies (templates unchanged from Phase 2) ----
locals {
  lambda_defs = {
    translate = { fn = "lyralearn-translate", role = "lyralearn-lambda-translate",
      policy_name = "lyralearn-translate-scoped", policy_file = "lambda-translate-policy.json",
    tag = "3.5", memory = 4096, env = { MONGODB_SECRET_ARN = var.mongodb_secret_arn, TABLE_NAME = "LyraLearnTable" } }
    chunk = { fn = "lyralearn-chunk-audio", role = "lyralearn-lambda-chunk",
      policy_name = "lyralearn-chunk-scoped", policy_file = "lambda-chunk-policy.json",
    tag = "2.4", memory = 2048, env = {} }
    stitch = { fn = "lyralearn-stitch-results", role = "lyralearn-lambda-stitch",
      policy_name = "lyralearn-stitch-scoped", policy_file = "lambda-stitch-policy.json",
    tag = "3.5", memory = 4096, env = {} }
  }
}

resource "aws_iam_role" "lambda" {
  for_each           = local.lambda_defs
  name               = each.value.role
  assume_role_policy = local.lambda_trust
}

resource "aws_iam_role_policy" "lambda" {
  for_each = local.lambda_defs
  name     = each.value.policy_name
  role     = aws_iam_role.lambda[each.key].id
  policy = replace(replace(replace(file("${local.infra}/${each.value.policy_file}"),
  "__BUCKET__", local.fill.B), "__REGION__", local.fill.R), "__ACCOUNT_ID__", local.fill.A)
}

resource "aws_lambda_function" "fn" {
  for_each      = local.lambda_defs
  function_name = each.value.fn
  package_type  = "Image"
  image_uri     = "${var.account_id}.dkr.ecr.${var.region}.amazonaws.com/${each.value.fn}:${each.value.tag}"
  role          = aws_iam_role.lambda[each.key].arn
  timeout       = 300
  memory_size   = each.value.memory

  dynamic "environment" {
    for_each = length(each.value.env) > 0 ? [each.value.env] : []
    content { variables = environment.value }
  }

  lifecycle {
    # Code deploys stay with scripts/aws/deploy_*_lambda.sh (update-function-code);
    # Terraform owns existence and configuration only.
    ignore_changes = [image_uri]
  }
}

# ---- Step Functions ----
resource "aws_iam_role" "sfn" {
  name               = "lyralearn-sfn-pipeline"
  assume_role_policy = file("${local.infra}/sfn-trust.json")
}

resource "aws_iam_role_policy" "sfn" {
  name = "lyralearn-sfn-scoped"
  role = aws_iam_role.sfn.id
  policy = replace(replace(replace(file("${local.infra}/sfn-pipeline-policy.json"),
  "__BUCKET__", local.fill.B), "__REGION__", local.fill.R), "__ACCOUNT_ID__", local.fill.A)
}

locals {
  render_linear = replace(replace(replace(replace(file("${local.infra}/pipeline-2.3.asl.json"),
    "__BUCKET__", local.fill.B), "__REGION__", local.fill.R), "__ACCOUNT_ID__", local.fill.A),
  "__IMAGE_TAG__", "2.2")
  render_chunked = replace(replace(replace(replace(replace(file("${local.infra}/pipeline-chunked.asl.json"),
    "__BUCKET__", local.fill.B), "__REGION__", local.fill.R), "__ACCOUNT_ID__", local.fill.A),
  "__IMAGE_TAG__", "2.4"), "__MAX_CONCURRENCY__", tostring(var.chunked_max_concurrency))
}

resource "aws_sfn_state_machine" "linear" {
  name       = "lyralearn-pipeline"
  role_arn   = aws_iam_role.sfn.arn
  definition = local.render_linear
}

resource "aws_sfn_state_machine" "chunked" {
  name       = "lyralearn-pipeline-chunked"
  role_arn   = aws_iam_role.sfn.arn
  definition = local.render_chunked
}

output "chunked_state_machine_arn" { value = aws_sfn_state_machine.chunked.arn }
