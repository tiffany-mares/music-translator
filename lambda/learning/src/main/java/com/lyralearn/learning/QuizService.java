package com.lyralearn.learning;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;

import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.regex.Pattern;

/**
 * GET /vocab/quiz: cloze questions for the user's due items, built from real
 * lyric lines. Kept separate from VocabService so the SM-2 path never grows a
 * Mongo dependency. Context resolution: linked songId first, then the
 * substring-prefilter fallback across songs; nothing found => hasContext=false
 * question (5.5 can still quiz on term/definition).
 */
public class QuizService {

    static final int MAX_QUESTIONS = 20; // bounds per-request Mongo work; due order = most-overdue first

    private final VocabRepository vocab;
    private final LyricsRepository lyrics;
    private final Clock clock;

    public QuizService(VocabRepository vocab, LyricsRepository lyrics, Clock clock) {
        this.vocab = vocab;
        this.lyrics = lyrics;
        this.clock = clock;
    }

    public JsonObject quiz(String userId) {
        Instant now = Instant.now(clock).truncatedTo(ChronoUnit.SECONDS); // 5.3 invariant
        List<DueItem> due = vocab.queryDue(userId, now);
        JsonArray questions = new JsonArray();
        for (DueItem d : due) {
            if (questions.size() >= MAX_QUESTIONS) break;
            questions.add(question(d));
        }
        JsonObject out = new JsonObject();
        out.add("questions", questions);
        out.addProperty("count", questions.size());
        return out;
    }

    private JsonObject question(DueItem d) {
        Context ctx = findContext(d);
        JsonObject q = new JsonObject();
        q.addProperty("vocabId", d.vocabId());
        q.addProperty("term", d.term());
        q.addProperty("definition", d.definition());
        q.addProperty("hasContext", ctx != null);
        // null values become explicit JSON nulls - stable shape for 5.5.
        q.addProperty("songId", ctx == null ? null : ctx.songId());
        q.addProperty("lineNumber", ctx == null ? null : (Integer) ctx.lineNumber());
        q.addProperty("prompt", ctx == null ? null : ctx.prompt());
        q.addProperty("translation", ctx == null ? null : ctx.translation());
        return q;
    }

    private record Context(String songId, int lineNumber, String prompt, String translation) {}

    private Context findContext(DueItem d) {
        if (d.term() == null) return null; // hand-seeded item without a term
        Pattern word = Cloze.wordPattern(d.term());
        if (d.songId() != null) {
            Context linked = lyrics.findBySongId(d.songId())
                    .map(s -> firstMatch(s, word)).orElse(null);
            if (linked != null) return linked;
            // fall through: linked song gone or term not actually in it
        }
        for (SongLyrics s : lyrics.findByTermSubstring(d.term())) {
            Context found = firstMatch(s, word);
            if (found != null) return found; // prefilter false positives land here as null
        }
        return null;
    }

    private static Context firstMatch(SongLyrics song, Pattern word) {
        for (LyricLine line : song.lines()) {
            if (word.matcher(line.originalText()).find()) {
                return new Context(song.songId(), line.lineNumber(),
                        Cloze.blank(line.originalText(), word), line.translatedText());
            }
        }
        return null;
    }
}
