package com.lyralearn.learning;

import java.time.Instant;

/**
 * SM-2 progress state for one vocab item. Field types inferred from the
 * architecture.md 5.5 reference (never declared there): the DynamoDB item
 * stores easeFactor/intervalDays/repetitions as Number and nextReviewAt as an
 * ISO-8601 UTC string (Instant.toString() round-trips exactly - and ISO order
 * IS chronological order, which GSI2's due-today query depends on).
 */
public class UserVocabProgress {

    private double easeFactor;
    private int intervalDays;
    private int repetitions;
    private Instant nextReviewAt;

    public double getEaseFactor() { return easeFactor; }
    public void setEaseFactor(double easeFactor) { this.easeFactor = easeFactor; }

    public int getIntervalDays() { return intervalDays; }
    public void setIntervalDays(int intervalDays) { this.intervalDays = intervalDays; }

    public int getRepetitions() { return repetitions; }
    public void setRepetitions(int repetitions) { this.repetitions = repetitions; }

    public Instant getNextReviewAt() { return nextReviewAt; }
    public void setNextReviewAt(Instant nextReviewAt) { this.nextReviewAt = nextReviewAt; }
}
