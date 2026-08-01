package store

import (
	"context"
	"errors"
	"testing"

	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

type fakeDynamo struct {
	putIn  *dynamodb.PutItemInput
	delIn  *dynamodb.DeleteItemInput
	putErr error
	delErr error
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
