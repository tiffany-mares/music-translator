"""Phase 3.5 gate helper: fetch a lyrics doc straight from Atlas, bypassing
the API route. Exit 0 if found, 1 if missing.

Usage: [MONGODB_URI=...] AWS_REGION=... python scripts/check_mongo_doc.py <songId>
"""
import json
import sys

from scripts.backfill_lyrics_to_mongo import mongo_uri


def main(song_id: str) -> int:
    from pymongo import MongoClient
    coll = MongoClient(mongo_uri(), serverSelectionTimeoutMS=10000)["lyralearn"]["lyrics"]
    doc = coll.find_one({"songId": song_id}, {"_id": 0})
    if doc is None:
        print(f"NOT FOUND in Atlas: {song_id}")
        return 1
    print(json.dumps({"songId": doc["songId"], "lineCount": len(doc.get("lines", [])),
                      "targetLanguage": doc.get("targetLanguage")}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
