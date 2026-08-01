package main

import (
	"context"
	"log"
	"os"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/apigatewaymanagementapi"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"

	"lyralearn/ws/internal/push"
	"lyralearn/ws/internal/store"
)

func mustEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		log.Fatalf("missing required env var %s", key)
	}
	return v
}

func main() {
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		log.Fatalf("aws config: %v", err)
	}
	ddb := dynamodb.NewFromConfig(cfg)
	endpoint := mustEnv("WS_MANAGEMENT_ENDPOINT") // https://{api-id}.execute-api.{region}.amazonaws.com/prod
	mgmt := apigatewaymanagementapi.NewFromConfig(cfg, func(o *apigatewaymanagementapi.Options) {
		o.BaseEndpoint = aws.String(endpoint)
	})
	conns := store.NewDynamoStore(ddb, mustEnv("CONNECTIONS_TABLE"))
	h := &push.Handler{
		Metadata:    push.NewSongMetadata(ddb, mustEnv("LYRALEARN_TABLE")),
		Connections: conns,
		Poster:      push.NewAPIPoster(mgmt),
		Cleanup:     conns, // GoneException cleanup reuses the store's Delete
	}
	lambda.Start(h.Handle)
}
