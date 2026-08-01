package com.lyralearn.learning;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** In-memory VocabRepository mirroring GSI2 semantics (ISO-string compare). */
class InMemoryVocabRepository implements VocabRepository {

    record Stored(String userId, String vocabId, double easeFactor, int intervalDays,
                  int repetitions, String nextReviewAt, String lastReviewedAt,
                  String term, String definition, String songId, String gsi2sk) {}

    final Map<String, Stored> items = new HashMap<>();

    private static String key(String userId, String vocabId) {
        return userId + "|" + vocabId;
    }

    void seed(String userId, String vocabId, double ef, int intervalDays, int reps,
              String nextReviewAt, String term, String definition) {
        seed(userId, vocabId, ef, intervalDays, reps, nextReviewAt, term, definition, null);
    }

    void seed(String userId, String vocabId, double ef, int intervalDays, int reps,
              String nextReviewAt, String term, String definition, String songId) {
        items.put(key(userId, vocabId), new Stored(userId, vocabId, ef, intervalDays,
                reps, nextReviewAt, null, term, definition, songId, nextReviewAt));
    }

    Stored get(String userId, String vocabId) {
        return items.get(key(userId, vocabId));
    }

    @Override
    public Optional<UserVocabProgress> loadProgress(String userId, String vocabId) {
        Stored s = items.get(key(userId, vocabId));
        if (s == null) return Optional.empty();
        UserVocabProgress p = new UserVocabProgress(); // defensive copy: service mutation must not alias the store
        p.setEaseFactor(s.easeFactor());
        p.setIntervalDays(s.intervalDays());
        p.setRepetitions(s.repetitions());
        p.setNextReviewAt(Instant.parse(s.nextReviewAt()));
        return Optional.of(p);
    }

    @Override
    public void saveReview(String userId, String vocabId, UserVocabProgress p,
                           Instant lastReviewedAt, String term, String definition, String songId) {
        Stored prev = items.get(key(userId, vocabId));
        String next = p.getNextReviewAt().toString();
        items.put(key(userId, vocabId), new Stored(userId, vocabId,
                p.getEaseFactor(), p.getIntervalDays(), p.getRepetitions(),
                next, lastReviewedAt.toString(),
                term != null ? term : (prev != null ? prev.term() : null),
                definition != null ? definition : (prev != null ? prev.definition() : null),
                songId != null ? songId : (prev != null ? prev.songId() : null),
                next)); // gsi2sk == nextReviewAt, like the UpdateExpression
    }

    @Override
    public List<DueItem> queryDue(String userId, Instant now) {
        String nowIso = now.toString();
        List<DueItem> out = new ArrayList<>();
        items.values().stream()
                .filter(s -> s.userId().equals(userId))
                .filter(s -> s.gsi2sk().compareTo(nowIso) <= 0)
                .sorted(Comparator.comparing(Stored::gsi2sk))
                .forEach(s -> out.add(new DueItem(s.vocabId(), s.term(), s.definition(), s.songId(), s.nextReviewAt())));
        return out;
    }
}
