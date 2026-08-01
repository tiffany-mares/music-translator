package com.lyralearn.learning;

import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.AttributeValue;
import software.amazon.awssdk.services.dynamodb.model.GetItemRequest;
import software.amazon.awssdk.services.dynamodb.model.GetItemResponse;
import software.amazon.awssdk.services.dynamodb.model.QueryRequest;
import software.amazon.awssdk.services.dynamodb.model.QueryResponse;
import software.amazon.awssdk.services.dynamodb.model.UpdateItemRequest;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Section 6.1 vocab items on LyraLearnTable. Thin by design - no logic beyond
 * marshalling; unit coverage lives against the in-memory fake, this class is
 * proven live by scripts/verify_5_3.sh.
 */
public class DynamoDbVocabRepository implements VocabRepository {

    private static final String VOCAB_PREFIX = "VOCAB#";

    private final DynamoDbClient ddb;
    private final String tableName;

    public DynamoDbVocabRepository(DynamoDbClient ddb, String tableName) {
        this.ddb = ddb;
        this.tableName = tableName;
    }

    private static Map<String, AttributeValue> key(String userId, String vocabId) {
        return Map.of(
                "PK", AttributeValue.fromS("USER#" + userId),
                "SK", AttributeValue.fromS(VOCAB_PREFIX + vocabId));
    }

    @Override
    public Optional<UserVocabProgress> loadProgress(String userId, String vocabId) {
        GetItemResponse res = ddb.getItem(GetItemRequest.builder()
                .tableName(tableName)
                .key(key(userId, vocabId))
                .build());
        if (!res.hasItem()) {
            return Optional.empty();
        }
        Map<String, AttributeValue> item = res.item();
        UserVocabProgress p = new UserVocabProgress();
        p.setEaseFactor(Double.parseDouble(item.get("easeFactor").n()));
        p.setIntervalDays(Integer.parseInt(item.get("intervalDays").n()));
        p.setRepetitions(Integer.parseInt(item.get("repetitions").n()));
        p.setNextReviewAt(Instant.parse(item.get("nextReviewAt").s()));
        return Optional.of(p);
    }

    @Override
    public void saveReview(String userId, String vocabId, UserVocabProgress p,
                           Instant lastReviewedAt, String term, String definition, String songId) {
        Map<String, AttributeValue> vals = new HashMap<>();
        // BigDecimal.valueOf(..).toPlainString(): plain decimal, never
        // scientific notation, so DynamoDB always accepts the N value.
        vals.put(":ef", AttributeValue.fromN(BigDecimal.valueOf(p.getEaseFactor()).toPlainString()));
        vals.put(":iv", AttributeValue.fromN(Integer.toString(p.getIntervalDays())));
        vals.put(":reps", AttributeValue.fromN(Integer.toString(p.getRepetitions())));
        vals.put(":next", AttributeValue.fromS(p.getNextReviewAt().toString()));
        vals.put(":last", AttributeValue.fromS(lastReviewedAt.toString()));
        vals.put(":gpk", AttributeValue.fromS("USER#" + userId));

        // GSI2SK reuses :next - the index key CANNOT drift from nextReviewAt.
        StringBuilder expr = new StringBuilder(
                "SET easeFactor = :ef, intervalDays = :iv, repetitions = :reps, "
                        + "nextReviewAt = :next, lastReviewedAt = :last, "
                        + "GSI2PK = :gpk, GSI2SK = :next");

        // #t/#d: expression-attribute-name indirection guards against the
        // DynamoDB reserved-word list ever mattering for these two.
        Map<String, String> names = new HashMap<>();
        if (term != null) {
            names.put("#t", "term");
            vals.put(":term", AttributeValue.fromS(term));
            expr.append(", #t = :term");
        }
        if (definition != null) {
            names.put("#d", "definition");
            vals.put(":def", AttributeValue.fromS(definition));
            expr.append(", #d = :def");
        }
        if (songId != null) {
            vals.put(":sid", AttributeValue.fromS(songId));
            expr.append(", songId = :sid");
        }

        UpdateItemRequest.Builder req = UpdateItemRequest.builder()
                .tableName(tableName)
                .key(key(userId, vocabId))          // UpdateItem upserts: create path and update path are one call
                .updateExpression(expr.toString())
                .expressionAttributeValues(vals);
        if (!names.isEmpty()) {
            req.expressionAttributeNames(names);
        }
        ddb.updateItem(req.build());
    }

    @Override
    public List<DueItem> queryDue(String userId, Instant now) {
        List<DueItem> out = new ArrayList<>();
        Map<String, AttributeValue> start = null;
        do {
            QueryRequest.Builder qb = QueryRequest.builder()
                    .tableName(tableName)
                    .indexName("GSI2")
                    .keyConditionExpression("GSI2PK = :u AND GSI2SK <= :now")
                    .expressionAttributeValues(Map.of(
                            ":u", AttributeValue.fromS("USER#" + userId),
                            ":now", AttributeValue.fromS(now.toString())));
            if (start != null) {
                qb.exclusiveStartKey(start);
            }
            QueryResponse res = ddb.query(qb.build());
            for (Map<String, AttributeValue> item : res.items()) {
                String sk = item.get("SK").s();
                if (!sk.startsWith(VOCAB_PREFIX)) {
                    continue; // GSI2 only carries vocab items today; guard anyway
                }
                out.add(new DueItem(
                        sk.substring(VOCAB_PREFIX.length()),
                        attrS(item, "term"),
                        attrS(item, "definition"),
                        attrS(item, "songId"),   // GSI2 projects ALL - present automatically
                        item.get("nextReviewAt").s()));
            }
            start = res.hasLastEvaluatedKey() ? res.lastEvaluatedKey() : null;
        } while (start != null);
        return out; // GSI2 range-ascending: most-overdue first
    }

    private static String attrS(Map<String, AttributeValue> item, String name) {
        AttributeValue v = item.get(name);
        return v == null ? null : v.s();
    }
}
