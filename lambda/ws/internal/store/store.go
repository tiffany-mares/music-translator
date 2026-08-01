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
	Query(ctx context.Context, in *dynamodb.QueryInput, opts ...func(*dynamodb.Options)) (*dynamodb.QueryOutput, error)
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

// ConnectionsByUser returns every live connectionId for a user via GSI1 —
// 6.2's reverse lookup. Deliberate §5.6 deviation (notes §6.2): the reference
// looks up a single connectionId, which breaks multi-tab; we fan out to all.
func (s *DynamoStore) ConnectionsByUser(ctx context.Context, userID string) ([]string, error) {
	var ids []string
	var start map[string]types.AttributeValue
	for {
		out, err := s.client.Query(ctx, &dynamodb.QueryInput{
			TableName:              aws.String(s.table),
			IndexName:              aws.String("GSI1"),
			KeyConditionExpression: aws.String("userId = :u"),
			ExpressionAttributeValues: map[string]types.AttributeValue{
				":u": &types.AttributeValueMemberS{Value: userID},
			},
			ExclusiveStartKey: start,
		})
		if err != nil {
			return nil, err
		}
		for _, item := range out.Items {
			if v, ok := item["connectionId"].(*types.AttributeValueMemberS); ok {
				ids = append(ids, v.Value)
			}
		}
		if out.LastEvaluatedKey == nil {
			return ids, nil
		}
		start = out.LastEvaluatedKey
	}
}
