#!/usr/bin/env bash
# Phase 2.1/2.2: manually trigger ONE whole-song SageMaker Processing Job.
# Usage: AWS_REGION=... ACCOUNT_ID=... BUCKET=... [IMAGE_TAG=2.2] scripts/aws/run_processing_job.sh
set -euo pipefail
: "${AWS_REGION:?}" "${ACCOUNT_ID:?}" "${BUCKET:?}"

IMAGE_TAG="${IMAGE_TAG:-2.1}"
SONG_ID="test-song-001"
JOB_NAME="lyralearn-${IMAGE_TAG//./-}-$(date +%Y%m%d-%H%M%S)"
IMAGE_URI="$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/lyralearn-ml:$IMAGE_TAG"
ROLE_ARN="arn:aws:iam::$ACCOUNT_ID:role/lyralearn-sagemaker-processing"
OUTPUT_S3="s3://$BUCKET/songs/$SONG_ID/ml-output/$JOB_NAME/"

aws sagemaker create-processing-job --region "$AWS_REGION" --cli-input-json "$(cat <<JSON
{
  "ProcessingJobName": "$JOB_NAME",
  "RoleArn": "$ROLE_ARN",
  "AppSpecification": { "ImageUri": "$IMAGE_URI" },
  "Environment": { "SONG_ID": "$SONG_ID", "SOURCE_LANGUAGE": "ro" },
  "ProcessingResources": {
    "ClusterConfig": { "InstanceCount": 1, "InstanceType": "ml.g4dn.xlarge", "VolumeSizeInGB": 50 }
  },
  "ProcessingInputs": [
    {
      "InputName": "song",
      "S3Input": {
        "S3Uri": "s3://$BUCKET/songs/$SONG_ID/raw/",
        "LocalPath": "/opt/ml/processing/input",
        "S3DataType": "S3Prefix",
        "S3InputMode": "File",
        "S3DataDistributionType": "FullyReplicated"
      }
    }
  ],
  "ProcessingOutputConfig": {
    "Outputs": [
      {
        "OutputName": "ml-output",
        "S3Output": {
          "S3Uri": "$OUTPUT_S3",
          "LocalPath": "/opt/ml/processing/output",
          "S3UploadMode": "EndOfJob"
        }
      }
    ]
  },
  "StoppingCondition": { "MaxRuntimeInSeconds": 7200 }
}
JSON
)"
echo "Started: $JOB_NAME"
echo "Output will land at: $OUTPUT_S3"
