package com.lyralearn.learning;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

/**
 * The 5.3 persistence seam. The DynamoDB impl stays thin (exercised by
 * scripts/verify_5_3.sh live); all handler/service logic is unit-tested
 * against the in-memory fake.
 */
public interface VocabRepository {

    /** SM-2 state for USER#{userId}/VOCAB#{vocabId}, empty if the item doesn't exist. */
    Optional<UserVocabProgress> loadProgress(String userId, String vocabId);

    /**
     * Upsert the post-schedule state: easeFactor/intervalDays/repetitions/
     * nextReviewAt/lastReviewedAt + GSI2PK/GSI2SK (GSI2SK == nextReviewAt by
     * construction). term/definition/songId written only when non-null
     * (create path; songId is 5.4's lyric-context link, sent by 5.5's
     * create-on-encounter).
     */
    void saveReview(String userId, String vocabId, UserVocabProgress p,
                    Instant lastReviewedAt, String term, String definition, String songId);

    /** GSI2 due-today query: GSI2PK = USER#{userId} AND GSI2SK <= now (ISO). */
    List<DueItem> queryDue(String userId, Instant now);

    /** Every vocab item the user has, soonest next-review first (Phase 7 follow-up: the collection view). */
    List<DueItem> queryAll(String userId);
}
