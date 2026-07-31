package com.lyralearn.learning;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * Reference outputs hand-computed from architecture.md 5.5's formula (see the
 * 5.2 plan's tables) and cross-checked against the canonical SM-2 all-perfect
 * sequence 1, 6, 17, 49, 147. These pin the SPEC's semantics - notably that
 * easeFactor is NOT updated on failure (no setEaseFactor call in the
 * quality < 3 branch), which some SM-2 variants do differently.
 */
class SpacedRepetitionServiceTest {

    private static final Instant NOW = Instant.parse("2026-08-01T00:00:00Z");
    private static final Clock FIXED = Clock.fixed(NOW, ZoneOffset.UTC);
    private static final double EPS = 1e-9;

    private static UserVocabProgress fresh() {
        UserVocabProgress p = new UserVocabProgress();
        p.setEaseFactor(2.5);
        p.setIntervalDays(0);
        p.setRepetitions(0);
        return p;
    }

    private final SpacedRepetitionService svc = new SpacedRepetitionService(FIXED);

    @ParameterizedTest
    @ValueSource(ints = {0, 1, 2})
    void failureResetsIntervalAndRepetitionsButNotEaseFactor(int quality) {
        UserVocabProgress p = fresh();
        p.setEaseFactor(2.8);
        p.setIntervalDays(17);
        p.setRepetitions(3);
        svc.schedule(p, quality);
        assertEquals(1, p.getIntervalDays());
        assertEquals(0, p.getRepetitions());
        assertEquals(2.8, p.getEaseFactor(), EPS); // spec: EF untouched on failure
        assertEquals(NOW.plus(1, ChronoUnit.DAYS), p.getNextReviewAt());
    }

    @Test
    void qualityThreeIsASuccess() {
        UserVocabProgress p = fresh();
        svc.schedule(p, 3);
        assertEquals(1, p.getRepetitions());
        assertEquals(1, p.getIntervalDays());
        assertEquals(2.36, p.getEaseFactor(), EPS); // 2.5 - 0.14
    }

    @Test
    void easeFactorDeltasPerQuality() {
        assertEquals(2.6, svc.schedule(fresh(), 5).getEaseFactor(), EPS);  // +0.10
        assertEquals(2.5, svc.schedule(fresh(), 4).getEaseFactor(), EPS);  //  0.00
        assertEquals(2.36, svc.schedule(fresh(), 3).getEaseFactor(), EPS); // -0.14
    }

    @Test
    void easeFactorFlooredAtOnePointThree() {
        UserVocabProgress p = fresh();
        p.setEaseFactor(1.3);
        svc.schedule(p, 3); // delta -0.14 would take it to 1.16
        assertEquals(1.3, p.getEaseFactor(), EPS);
    }

    @Test
    void perfectRecallSequenceMatchesCanonicalSm2() {
        UserVocabProgress p = fresh();
        int[] expectedIntervals = {1, 6, 17, 49, 147};
        double[] expectedEf = {2.6, 2.7, 2.8, 2.9, 3.0};
        for (int i = 0; i < 5; i++) {
            svc.schedule(p, 5);
            assertEquals(expectedIntervals[i], p.getIntervalDays(), "interval, review " + (i + 1));
            assertEquals(expectedEf[i], p.getEaseFactor(), EPS, "EF, review " + (i + 1));
            assertEquals(i + 1, p.getRepetitions());
        }
    }

    @Test
    void qualityFourSequenceKeepsEaseFactorConstant() {
        UserVocabProgress p = fresh();
        // round(37.5) = 38 with Java's half-up Math.round; see plan's float-boundary note.
        int[] expectedIntervals = {1, 6, 15, 38, 95};
        for (int i = 0; i < 5; i++) {
            svc.schedule(p, 4);
            assertEquals(expectedIntervals[i], p.getIntervalDays(), "interval, review " + (i + 1));
            assertEquals(2.5, p.getEaseFactor(), EPS);
        }
    }

    @Test
    void qualityThreeSequenceDecaysEaseFactor() {
        UserVocabProgress p = fresh();
        int[] expectedIntervals = {1, 6, 12, 23, 41};
        double[] expectedEf = {2.36, 2.22, 2.08, 1.94, 1.80};
        for (int i = 0; i < 5; i++) {
            svc.schedule(p, 3);
            assertEquals(expectedIntervals[i], p.getIntervalDays(), "interval, review " + (i + 1));
            assertEquals(expectedEf[i], p.getEaseFactor(), EPS, "EF, review " + (i + 1));
        }
    }

    @Test
    void failureRestartsIntervalLadderButKeepsEarnedEaseFactor() {
        UserVocabProgress p = fresh();
        svc.schedule(p, 5); // 1d, EF 2.6
        svc.schedule(p, 5); // 6d, EF 2.7
        svc.schedule(p, 5); // 17d, EF 2.8
        svc.schedule(p, 1); // failure: 1d, reps 0, EF stays 2.8
        assertEquals(1, p.getIntervalDays());
        assertEquals(0, p.getRepetitions());
        assertEquals(2.8, p.getEaseFactor(), EPS);
        svc.schedule(p, 5); // recovery rep 1: 1d, EF 2.9
        assertEquals(1, p.getIntervalDays());
        assertEquals(2.9, p.getEaseFactor(), EPS);
        svc.schedule(p, 5); // rep 2: 6d, EF 3.0
        assertEquals(6, p.getIntervalDays());
        assertEquals(3.0, p.getEaseFactor(), EPS);
    }

    @Test
    void nextReviewAtIsClockPlusIntervalDays() {
        UserVocabProgress p = fresh();
        svc.schedule(p, 5);
        svc.schedule(p, 5); // interval now 6
        assertEquals(NOW.plus(6, ChronoUnit.DAYS), p.getNextReviewAt());
    }

    @ParameterizedTest
    @ValueSource(ints = {-1, 6, 42})
    void qualityOutsideZeroToFiveThrows(int quality) {
        // Spec comments "/* 0-5 */" without enforcing it; q=6 would INFLATE the
        // ease factor through the negative (5-q) terms. Documented hardening.
        assertThrows(IllegalArgumentException.class, () -> svc.schedule(fresh(), quality));
    }

    @Test
    void mutatesAndReturnsTheSameInstance() {
        UserVocabProgress p = fresh();
        assertSame(p, svc.schedule(p, 4));
    }
}
