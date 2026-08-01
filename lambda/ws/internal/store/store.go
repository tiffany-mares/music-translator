// Package store owns WebSocketConnections rows: connectionId (PK) + userId
// (GSI1 hash for 6.2's reverse lookup). No TTL — spec has none; stale rows
// from unclean disconnects are cleaned by 6.2's GoneException handling.
package store

import (
	"context"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// ConnectionStore is the handler-facing seam; tests supply fakes.
type ConnectionStore interface {
	Put(ctx context.Context, connectionID, userID string) error
	Delete(ctx context.Context, connectionID string) error
}

// DynamoAPI is the SDK subset DynamoStore needs (satisfied by *dynamodb.Client).
type DynamoAPI interface {
	PutItem(ctx context.Context, in *dynamodb.PutItemInput, opts ...func(*dynamodb.Options)) (*dynamodb.PutItemOutput, error)
	DeleteItem(ctx context.Context, in *dynamodb.DeleteItemInput, opts ...func(*dynamodb.Options)) (*dynamodb.DeleteItemOutput, error)
}

type DynamoStore struct {
	client DynamoAPI
	table  string
}

func NewDynamoStore(client DynamoAPI, table string) *DynamoStore {
	return &DynamoStore{client: client, table: table}
}

func (s *DynamoStore) Put(ctx context.Context, connectionID, userID string) error {
	_, err := s.client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(s.table),
		Item: map[string]types.AttributeValue{
			"connectionId": &types.AttributeValueMemberS{Value: connectionID},
			"userId":       &types.AttributeValueMemberS{Value: userID},
		},
	})
	return err
}

func (s *DynamoStore) Delete(ctx context.Context, connectionID string) error {
	_, err := s.client.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: aws.String(s.table),
		Key: map[string]types.AttributeValue{
			"connectionId": &types.AttributeValueMemberS{Value: connectionID},
		},
	})
	return err
}
