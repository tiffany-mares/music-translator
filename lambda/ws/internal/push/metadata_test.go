package push

import (
	"context"
	"errors"
	"testing"

	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

type fakeGet struct {
	in  *dynamodb.GetItemInput
	out *dynamodb.GetItemOutput
	err error
}

func (f *fakeGet) GetItem(_ context.Context, in *dynamodb.GetItemInput, _ ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error) {
	f.in = in
	if f.err != nil {
		return nil, f.err
	}
	return f.out, nil
}

func TestUploadedByReadsMetadataItem(t *testing.T) {
	f := &fakeGet{out: &dynamodb.GetItemOutput{Item: map[string]types.AttributeValue{
		"uploadedBy": &types.AttributeValueMemberS{Value: "sub-1"},
	}}}
	got, err := NewSongMetadata(f, "LyraLearnTable").UploadedBy(context.Background(), "song-1")
	if err != nil || got != "sub-1" {
		t.Fatalf("got (%q, %v), want (sub-1, nil)", got, err)
	}
	if *f.in.TableName != "LyraLearnTable" {
		t.Fatalf("table = %q", *f.in.TableName)
	}
	pk := f.in.Key["PK"].(*types.AttributeValueMemberS).Value
	sk := f.in.Key["SK"].(*types.AttributeValueMemberS).Value
	if pk != "SONG#song-1" || sk != "METADATA" {
		t.Fatalf("key = (%q, %q), want (SONG#song-1, METADATA)", pk, sk)
	}
}

func TestUploadedByMissingItemReturnsEmptyNoError(t *testing.T) {
	f := &fakeGet{out: &dynamodb.GetItemOutput{}} // no Item
	got, err := NewSongMetadata(f, "T").UploadedBy(context.Background(), "song-1")
	if err != nil || got != "" {
		t.Fatalf("got (%q, %v), want (\"\", nil)", got, err)
	}
}

func TestUploadedByErrorPropagates(t *testing.T) {
	f := &fakeGet{err: errors.New("get boom")}
	if _, err := NewSongMetadata(f, "T").UploadedBy(context.Background(), "s"); err == nil {
		t.Fatal("error swallowed")
	}
}
