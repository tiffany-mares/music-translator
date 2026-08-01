"""Phase 7 follow-up: soft-archive songs out of the public catalog.

Sets status=ARCHIVED on each song's METADATA item (GET /songs hides that
status). Reversible: previousStatus is stored alongside, and --restore puts
it back. Never creates items (ConditionExpression attribute_exists).

Usage: AWS_REGION=us-east-1 python scripts/archive_songs.py [--restore] songId [songId ...]
"""
import os
import sys


def archive(ddb, table: str, song_ids: list[str], restore: bool = False) -> tuple[int, int]:
    done = skipped = 0
    for song_id in song_ids:
        key = {"PK": {"S": f"SONG#{song_id}"}, "SK": {"S": "METADATA"}}
        try:
            if restore:
                item = ddb.get_item(TableName=table, Key=key).get("Item", {})
                prev = item.get("previousStatus", {}).get("S")
                if not prev:
                    print(f"SKIP {song_id}: no previousStatus to restore")
                    skipped += 1
                    continue
                ddb.update_item(
                    TableName=table, Key=key,
                    ConditionExpression="attribute_exists(PK)",
                    UpdateExpression="SET #s = :prev REMOVE previousStatus",
                    ExpressionAttributeNames={"#s": "status"},
                    ExpressionAttributeValues={":prev": {"S": prev}})
                print(f"restored {song_id}: {prev}")
            else:
                ddb.update_item(
                    TableName=table, Key=key,
                    # Idempotence: never double-archive (it would overwrite
                    # previousStatus with ARCHIVED and lose the original).
                    # Malformed shells may lack status entirely - archive those
                    # too, recording UNKNOWN as the previous value.
                    ConditionExpression=(
                        "attribute_exists(PK) AND "
                        "(attribute_not_exists(#s) OR #s <> :archived)"),
                    UpdateExpression=(
                        "SET previousStatus = if_not_exists(#s, :unknown), "
                        "#s = :archived"),
                    ExpressionAttributeNames={"#s": "status"},
                    ExpressionAttributeValues={":archived": {"S": "ARCHIVED"},
                                               ":unknown": {"S": "UNKNOWN"}})
                print(f"archived {song_id}")
            done += 1
        except ddb.exceptions.ConditionalCheckFailedException:
            print(f"SKIP {song_id}: missing or already archived")
            skipped += 1
    return done, skipped


def main() -> int:
    import boto3

    args = [a for a in sys.argv[1:] if a != "--restore"]
    restore = "--restore" in sys.argv[1:]
    if not args:
        print(__doc__)
        return 2
    ddb = boto3.client("dynamodb")
    table = os.environ.get("TABLE_NAME", "LyraLearnTable")
    done, skipped = archive(ddb, table, args, restore=restore)
    print(f"done: {done} {'restored' if restore else 'archived'}, {skipped} skipped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
