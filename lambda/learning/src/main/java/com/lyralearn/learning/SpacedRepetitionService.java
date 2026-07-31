package com.lyralearn.learning;

import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;

/**
 * SM-2 scheduling, character-faithful to the architecture.md 5.5 reference
 * with two documented deviations:
 *  - Clock injection (Instant.now(clock)) so tests are deterministic;
 *    semantics identical, default Clock.systemUTC().
 *  - Quality range enforcement: the reference comments "0-5" without checking;
 *    q > 5 would INFLATE the ease factor via the negative (5-q) terms, so
 *    out-of-range quality throws instead of silently corrupting schedules.
 * Spec properties the tests pin: easeFactor is NOT updated on failure
 * (quality < 3); the interval multiplies by the UPDATED, floored easeFactor;
 * floor 1.3, no cap; Math.round half-up.
 */
public class SpacedRepetitionService {

    private final Clock clock;

    public SpacedRepetitionService() {
        this(Clock.systemUTC());
    }

    public SpacedRepetitionService(Clock clock) {
        this.clock = clock;
    }

    public UserVocabProgress schedule(UserVocabProgress p, int quality /* 0-5 */) {
        if (quality < 0 || quality > 5) {
            throw new IllegalArgumentException("quality must be 0-5, got " + quality);
        }
        if (quality < 3) {
            p.setIntervalDays(1);
            p.setRepetitions(0);
        } else {
            double ef = p.getEaseFactor();
            ef = ef + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
            p.setEaseFactor(Math.max(1.3, ef));
            int reps = p.getRepetitions() + 1;
            int interval = reps == 1 ? 1 : reps == 2 ? 6 : (int) Math.round(p.getIntervalDays() * p.getEaseFactor());
            p.setIntervalDays(interval);
            p.setRepetitions(reps);
        }
        p.setNextReviewAt(Instant.now(clock).plus(p.getIntervalDays(), ChronoUnit.DAYS));
        return p;
    }
}
