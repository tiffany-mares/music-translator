variable "region" { type = string }
variable "account_id" { type = string }
variable "audio_bucket" { type = string }

output "sagemaker_role_arn" { value = "" }
