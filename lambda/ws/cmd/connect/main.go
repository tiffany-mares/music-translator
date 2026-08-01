package main

import (
	"context"
	"log"
	"os"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"

	"lyralearn/ws/internal/auth"
	"lyralearn/ws/internal/handler"
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
	issuer := mustEnv("COGNITO_ISSUER")
	h := &handler.Connect{
		Auth:  auth.New(issuer, mustEnv("CLIENT_ID"), issuer+"/.well-known/jwks.json"),
		Store: store.NewDynamoStore(dynamodb.NewFromConfig(cfg), mustEnv("TABLE_NAME")),
	}
	lambda.Start(h.Handle)
}
