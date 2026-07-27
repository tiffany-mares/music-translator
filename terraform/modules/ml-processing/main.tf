variable "region" { type = string }
variable "account_id" { type = string }
variable "audio_bucket" { type = string }

locals {
  repo_names = ["lyralearn-ml", "lyralearn-translate", "lyralearn-chunk-audio", "lyralearn-stitch-results"]
  sagemaker_policy = replace(replace(replace(
    file("${path.module}/../../../infra/aws/sagemaker-processing-policy.json"),
    "__BUCKET__", var.audio_bucket), "__REGION__", var.region), "__ACCOUNT_ID__", var.account_id)
}

resource "aws_ecr_repository" "repos" {
  for_each = toset(local.repo_names)
  name     = each.key
}

resource "aws_iam_role" "sagemaker_processing" {
  name               = "lyralearn-sagemaker-processing"
  assume_role_policy = file("${path.module}/../../../infra/aws/sagemaker-trust.json")
}

resource "aws_iam_role_policy" "sagemaker_scoped" {
  name   = "lyralearn-processing-scoped"
  role   = aws_iam_role.sagemaker_processing.id
  policy = local.sagemaker_policy
}

output "sagemaker_role_arn" { value = aws_iam_role.sagemaker_processing.arn }
