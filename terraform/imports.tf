import {
  to = module.storage.aws_s3_bucket.audio
  id = "lyralearn-audio-503233513399"
}
import {
  to = module.storage.aws_dynamodb_table.main
  id = "LyraLearnTable"
}
import {
  # Created by the first (credential-expired) apply but never written to state.
  to = module.storage.aws_dynamodb_table.ws_connections
  id = "WebSocketConnections"
}
import {
  # Same story: created by the second credential-expired apply, never in state.
  to = module.api.aws_cognito_user_pool.users
  id = "us-east-1_m1EBuRGMm"
}
import {
  to = module.api.aws_cognito_user_pool_client.web
  id = "us-east-1_m1EBuRGMm/3a0g52nr1supgrak3u1lbambp6"
}
import {
  to = module.ml_processing.aws_ecr_repository.repos["lyralearn-ml"]
  id = "lyralearn-ml"
}
import {
  to = module.ml_processing.aws_ecr_repository.repos["lyralearn-translate"]
  id = "lyralearn-translate"
}
import {
  to = module.ml_processing.aws_ecr_repository.repos["lyralearn-chunk-audio"]
  id = "lyralearn-chunk-audio"
}
import {
  to = module.ml_processing.aws_ecr_repository.repos["lyralearn-stitch-results"]
  id = "lyralearn-stitch-results"
}
import {
  to = module.ml_processing.aws_iam_role.sagemaker_processing
  id = "lyralearn-sagemaker-processing"
}
import {
  to = module.ml_processing.aws_iam_role_policy.sagemaker_scoped
  id = "lyralearn-sagemaker-processing:lyralearn-processing-scoped"
}
import {
  to = module.orchestration.aws_iam_role.lambda["translate"]
  id = "lyralearn-lambda-translate"
}
import {
  to = module.orchestration.aws_iam_role.lambda["chunk"]
  id = "lyralearn-lambda-chunk"
}
import {
  to = module.orchestration.aws_iam_role.lambda["stitch"]
  id = "lyralearn-lambda-stitch"
}
import {
  to = module.orchestration.aws_iam_role_policy.lambda["translate"]
  id = "lyralearn-lambda-translate:lyralearn-translate-scoped"
}
import {
  to = module.orchestration.aws_iam_role_policy.lambda["chunk"]
  id = "lyralearn-lambda-chunk:lyralearn-chunk-scoped"
}
import {
  to = module.orchestration.aws_iam_role_policy.lambda["stitch"]
  id = "lyralearn-lambda-stitch:lyralearn-stitch-scoped"
}
import {
  to = module.orchestration.aws_lambda_function.fn["translate"]
  id = "lyralearn-translate"
}
import {
  to = module.orchestration.aws_lambda_function.fn["chunk"]
  id = "lyralearn-chunk-audio"
}
import {
  to = module.orchestration.aws_lambda_function.fn["stitch"]
  id = "lyralearn-stitch-results"
}
import {
  to = module.orchestration.aws_iam_role.sfn
  id = "lyralearn-sfn-pipeline"
}
import {
  to = module.orchestration.aws_iam_role_policy.sfn
  id = "lyralearn-sfn-pipeline:lyralearn-sfn-scoped"
}
import {
  to = module.orchestration.aws_sfn_state_machine.linear
  id = "arn:aws:states:us-east-1:503233513399:stateMachine:lyralearn-pipeline"
}
import {
  to = module.orchestration.aws_sfn_state_machine.chunked
  id = "arn:aws:states:us-east-1:503233513399:stateMachine:lyralearn-pipeline-chunked"
}
