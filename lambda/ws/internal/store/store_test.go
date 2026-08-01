package store

import (
	"context"
	"errors"
	"testing"

	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

type fakeDynamo struct {
	putIn     *dynamodb.PutItemInput
	delIn     *dynamodb.DeleteItemInput
	putErr    error
	delErr    error
	queryIns  []*dynamodb.QueryInput
	queryOuts []*dynamodb.QueryOutput
	queryErr  error
}

func (f *fakeDynamo) Query(_ context.Context, in *dynamodb.QueryInput, _ ...func(*dynamodb.Options)) (*dynamodb.QueryOutput, error) {
	f.queryIns = append(f.queryIns, in)
	if f.queryErr != nil {
		return nil, f.queryErr
	}
	return f.queryOuts[len(f.queryIns)-1], nil
}

func connItem(id string) map[string]types.AttributeValue {
	return map[string]types.AttributeValue{"connectionId": &types.AttributeValueMemberS{Value: id}}
}

func (f *fakeDynamo) PutItem(_ context.Context, in *dynamodb.PutItemInput, _ ...func(*dynamodb.Options)) (*dynamodb.PutItemOutput, error) {
	f.putIn = in
	return &dynamodb.PutItemOutput{}, f.putErr
}

func (f *fakeDynamo) DeleteItem(_ context.Context, in *dynamodb.DeleteItemInput, _ ...func(*dynamodb.Options)) (*dynamodb.DeleteItemOutput, error) {
	f.delIn = in
	return &dynamodb.DeleteItemOutput{}, f.delErr
}

func TestPutWritesConnectionAndUser(t *testing.T) {
	f := &fakeDynamo{}
	s := NewDynamoStore(f, "WebSocketConnections")
	if err := s.Put(context.Background(), "conn-1", "sub-1"); err != nil {
		t.Fatal(err)
	}
	if *f.putIn.TableName != "WebSocketConnections" {
		t.Fatalf("table = %q", *f.putIn.TableName)
	}
	conn := f.putIn.Item["connectionId"].(*types.AttributeValueMemberS).Value
	user := f.putIn.Item["userId"].(*types.AttributeValueMemberS).Value
	if conn != "conn-1" || user != "sub-1" {
		t.Fatalf("item (%q,%q), want (conn-1, sub-1)", conn, user)
	}
}

func TestDeleteKeysByConnectionID(t *testing.T) {
	f := &fakeDynamo{}
	s := NewDynamoStore(f, "WebSocketConnections")
	if err := s.Delete(context.Background(), "conn-1"); err != nil {
		t.Fatal(err)
	}
	if *f.delIn.TableName != "WebSocketConnections" {
		t.Fatalf("table = %q", *f.delIn.TableName)
	}
	key := f.delIn.Key["connectionId"].(*types.AttributeValueMemberS).Value
	if key != "conn-1" {
		t.Fatalf("key = %q, want conn-1", key)
	}
}

func TestErrorsPropagate(t *testing.T) {
	f := &fakeDynamo{putErr: errors.New("put boom"), delErr: errors.New("del boom")}
	s := NewDynamoStore(f, "T")
	if err := s.Put(context.Background(), "c", "u"); err == nil {
		t.Fatal("put error swallowed")
	}
	if err := s.Delete(context.Background(), "c"); err == nil {
		t.Fatal("delete error swallowed")
	}
}

func TestConnectionsByUserQueriesGSI1(t *testing.T) {
	f := &fakeDynamo{queryOuts: []*dynamodb.QueryOutput{
		{Items: []map[string]types.AttributeValue{connItem("c1"), connItem("c2")}},
	}}
	s := NewDynamoStore(f, "WebSocketConnections")
	ids, err := s.ConnectionsByUser(context.Background(), "sub-1")
	if err != nil {
		t.Fatal(err)
	}
	in := f.queryIns[0]
	if *in.TableName != "WebSocketConnections" || *in.IndexName != "GSI1" {
		t.Fatalf("queried %q/%v, want WebSocketConnections/GSI1", *in.TableName, in.IndexName)
	}
	u := in.ExpressionAttributeValues[":u"].(*types.AttributeValueMemberS).Value
	if u != "sub-1" {
		t.Fatalf(":u = %q, want sub-1", u)
	}
	if len(ids) != 2 || ids[0] != "c1" || ids[1] != "c2" {
		t.Fatalf("ids = %v, want [c1 c2]", ids)
	}
}

func TestConnectionsByUserPaginates(t *testing.T) {
	last := map[string]types.AttributeValue{"connectionId": &types.AttributeValueMemberS{Value: "c1"}}
	f := &fakeDynamo{queryOuts: []*dynamodb.QueryOutput{
		{Items: []map[string]types.AttributeValue{connItem("c1")}, LastEvaluatedKey: last},
		{Items: []map[string]types.AttributeValue{connItem("c2")}},
	}}
	s := NewDynamoStore(f, "T")
	ids, err := s.ConnectionsByUser(context.Background(), "sub-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(f.queryIns) != 2 || f.queryIns[1].ExclusiveStartKey == nil {
		t.Fatalf("pagination not followed: %d calls", len(f.queryIns))
	}
	if len(ids) != 2 {
		t.Fatalf("ids = %v, want 2 across pages", ids)
	}
}

func TestConnectionsByUserErrorPropagates(t *testing.T) {
	f := &fakeDynamo{queryErr: errors.New("query boom")}
	if _, err := NewDynamoStore(f, "T").ConnectionsByUser(context.Background(), "u"); err == nil {
		t.Fatal("query error swallowed")
	}
}
