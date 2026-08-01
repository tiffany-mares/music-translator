package com.lyralearn.learning;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;

/**
 * POST /vocab/review + GET /vocab/due business logic, decoupled from Lambda
 * plumbing so it runs against the in-memory fake in tests.
 *
 * All persisted instants are truncated to whole seconds: Instant.toString()
 * is variable-precision, and MIXED-precision ISO strings break the
 * lexicographic==chronological invariant GSI2 depends on within a second
 * ("...00.5Z" < "...00Z" lexically). Fixed-width yyyy-MM-ddTHH:mm:ssZ matches
 * the 5.1 seeds and shell `date -u +%Y-%m-%dT%H:%M:%SZ`.
 */
public class VocabService {

    private final VocabRepository repo;
    private final SpacedRepetitionService srs;
    private final Clock clock;

    public VocabService(VocabRepository repo, Clock clock) {
        this.repo = repo;
        this.srs = new SpacedRepetitionService(clock);
        this.clock = clock;
    }

    /** @throws ApiException 400 on bad body/quality, 404 on unknown item without term */
    public JsonObject review(String userId, String body) {
        JsonObject req = parseObject(body);
        String vocabId = optString(req, "vocabId");
        if (vocabId == null) {
            throw new ApiException(400, "vocabId is required");
        }
        int quality = requireQuality(req);
        String term = optString(req, "term");
        String definition = optString(req, "definition");
        String songId = optString(req, "songId"); // 5.4: lyric-context link, optional

        UserVocabProgress p = repo.loadProgress(userId, vocabId).orElse(null);
        boolean created = (p == null);
        if (created) {
            if (term == null) {
                throw new ApiException(404, "unknown vocab item; include term/definition to create it");
            }
            p = new UserVocabProgress();
            p.setEaseFactor(2.5);   // SM-2 defaults for a first encounter
            p.setIntervalDays(0);
            p.setRepetitions(0);
        }

        srs.schedule(p, quality);   // quality pre-validated; cannot throw here
        p.setNextReviewAt(p.getNextReviewAt().truncatedTo(ChronoUnit.SECONDS));
        Instant lastReviewedAt = Instant.now(clock).truncatedTo(ChronoUnit.SECONDS);

        repo.saveReview(userId, vocabId, p, lastReviewedAt, term, definition, songId);

        JsonObject out = new JsonObject();
        out.addProperty("vocabId", vocabId);
        out.addProperty("nextReviewAt", p.getNextReviewAt().toString());
        out.addProperty("intervalDays", p.getIntervalDays());
        out.addProperty("repetitions", p.getRepetitions());
        out.addProperty("easeFactor", p.getEaseFactor());
        out.addProperty("created", created);
        return out;
    }

    public JsonObject due(String userId) {
        Instant now = Instant.now(clock).truncatedTo(ChronoUnit.SECONDS);
        List<DueItem> items = repo.queryDue(userId, now);
        JsonArray arr = new JsonArray();
        for (DueItem d : items) {
            JsonObject o = new JsonObject();
            o.addProperty("vocabId", d.vocabId());
            o.addProperty("term", d.term());
            o.addProperty("definition", d.definition());
            o.addProperty("songId", d.songId()); // null -> explicit JSON null, additive for 5.5
            o.addProperty("nextReviewAt", d.nextReviewAt());
            arr.add(o);
        }
        JsonObject out = new JsonObject();
        out.add("items", arr);
        out.addProperty("count", items.size());
        return out;
    }

    private static JsonObject parseObject(String body) {
        if (body == null || body.isBlank()) {
            throw new ApiException(400, "request body is required");
        }
        try {
            JsonElement el = JsonParser.parseString(body);
            if (!el.isJsonObject()) {
                throw new ApiException(400, "body must be a JSON object");
            }
            return el.getAsJsonObject();
        } catch (ApiException e) {
            throw e;
        } catch (RuntimeException e) {
            throw new ApiException(400, "body is not valid JSON");
        }
    }

    private static int requireQuality(JsonObject req) {
        JsonElement q = req.get("quality");
        if (q == null || !q.isJsonPrimitive() || !q.getAsJsonPrimitive().isNumber()) {
            throw new ApiException(400, "quality must be a number 0-5");
        }
        double d = q.getAsDouble();
        int quality = (int) d;
        if (d != quality) {
            throw new ApiException(400, "quality must be an integer 0-5");
        }
        if (quality < 0 || quality > 5) {
            throw new ApiException(400, "quality must be 0-5, got " + quality);
        }
        return quality;
    }

    private static String optString(JsonObject req, String name) {
        JsonElement el = req.get(name);
        if (el == null || !el.isJsonPrimitive() || !el.getAsJsonPrimitive().isString()) {
            return null;
        }
        String s = el.getAsString();
        return s.isBlank() ? null : s;
    }
}
