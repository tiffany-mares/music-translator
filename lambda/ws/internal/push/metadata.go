package push

import (
	"context"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// DynamoGetAPI is the SDK subset SongMetadata needs (satisfied by *dynamodb.Client).
type DynamoGetAPI interface {
	GetItem(ctx context.Context, in *dynamodb.GetItemInput, opts ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error)
}

// SongMetadata resolves SONG#{songId}/METADATA.uploadedBy — the only place
// the owner's Cognito sub lives (job items carry no userId; notes §6.2).
type SongMetadata struct {
	client DynamoGetAPI
	table  string
}

func NewSongMetadata(client DynamoGetAPI, table string) *SongMetadata {
	return &SongMetadata{client: client, table: table}
}

func (s *SongMetadata) UploadedBy(ctx context.Context, songID string) (string, error) {
	out, err := s.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(s.table),
		Key: map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: "SONG#" + songID},
			"SK": &types.AttributeValueMemberS{Value: "METADATA"},
		},
		ProjectionExpression: aws.String("uploadedBy"),
	})
	if err != nil {
		return "", err
	}
	if v, ok := out.Item["uploadedBy"].(*types.AttributeValueMemberS); ok {
		return v.Value, nil
	}
	return "", nil
}
