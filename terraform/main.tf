terraform {
  required_version = ">= 1.10"
  required_providers {
    aws     = { source = "hashicorp/aws", version = "~> 5.0" }
    archive = { source = "hashicorp/archive", version = "~> 2.4" }
  }
  backend "s3" {
    bucket       = "lyralearn-tfstate-503233513399"
    key          = "lyralearn.tfstate"
    region       = "us-east-1"
    use_lockfile = true
  }
}

provider "aws" {
  region = var.region
}

variable "region" {
  type    = string
  default = "us-east-1"
}
variable "account_id" {
  type    = string
  default = "503233513399"
}
variable "audio_bucket" {
  type    = string
  default = "lyralearn-audio-503233513399"
}
variable "chunked_max_concurrency" {
  type    = number
  default = 1 # bump alongside the g4dn quota; deploy scripts historically used MAX_CONCURRENCY
}

module "storage" {
  source          = "./modules/storage"
  audio_bucket    = var.audio_bucket
  frontend_origin = "https://${module.frontend.domain_name}"
}

module "ml_processing" {
  source       = "./modules/ml-processing"
  region       = var.region
  account_id   = var.account_id
  audio_bucket = var.audio_bucket
}

module "orchestration" {
  source                  = "./modules/orchestration"
  region                  = var.region
  account_id              = var.account_id
  audio_bucket            = var.audio_bucket
  chunked_max_concurrency = var.chunked_max_concurrency
  sagemaker_role_arn      = module.ml_processing.sagemaker_role_arn
  mongodb_secret_arn      = module.storage.mongodb_secret_arn
}

module "frontend" {
  source     = "./modules/frontend"
  account_id = var.account_id
}

module "api" {
  source                      = "./modules/api"
  region                      = var.region
  account_id                  = var.account_id
  audio_bucket                = var.audio_bucket
  mongodb_secret_arn          = module.storage.mongodb_secret_arn
  chunked_state_machine_arn   = module.orchestration.chunked_state_machine_arn
  frontend_origin             = "https://${module.frontend.domain_name}"
}

output "user_pool_id" {
  value = module.api.user_pool_id
}
output "user_pool_client_id" {
  value = module.api.user_pool_client_id
}
output "jwt_issuer" {
  value = module.api.jwt_issuer
}
output "api_endpoint" {
  value = module.api.api_endpoint
}
output "frontend_bucket" {
  value = module.frontend.bucket_name
}
output "cloudfront_distribution_id" {
  value = module.frontend.distribution_id
}
output "cloudfront_domain" {
  value = module.frontend.domain_name
}
