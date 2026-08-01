package com.lyralearn.learning;

import com.amazonaws.services.lambda.runtime.events.APIGatewayV2HTTPEvent;
import com.amazonaws.services.lambda.runtime.events.APIGatewayV2HTTPResponse;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class HandlerTest {

    private static final Instant NOW = Instant.parse("2026-07-31T10:00:00Z");
    private static final String SUB = "user-sub-123";

    private final InMemoryVocabRepository repo = new InMemoryVocabRepository();
    private final InMemoryLyricsRepository lyricsRepo = new InMemoryLyricsRepository();

    private Handler handler() {
        return handler(NOW);
    }

    private Handler handler(Instant now) {
        Clock clock = Clock.fixed(now, ZoneOffset.UTC);
        return new Handler(new VocabService(repo, clock),
                new QuizService(repo, lyricsRepo, clock));
    }

    private static LyricLine line(int n, String ro, String en) {
        return new LyricLine(n, ro, en);
    }

    private void addSong(String songId, LyricLine... lines) {
        lyricsRepo.add(new SongLyrics(songId, List.of(lines)));
    }

    private JsonObject quiz() {
        APIGatewayV2HTTPResponse res = handler()
                .handleRequest(event("GET", "/vocab/quiz", null, SUB, false), null);
        assertEquals(200, res.getStatusCode());
        return body(res);
    }

    private static APIGatewayV2HTTPEvent event(String method, String path, String body,
                                               String sub, boolean base64) {
        var ctx = APIGatewayV2HTTPEvent.RequestContext.builder()
                .withHttp(APIGatewayV2HTTPEvent.RequestContext.Http.builder()
                        .withMethod(method).withPath(path).build());
        if (sub != null) {
            ctx.withAuthorizer(APIGatewayV2HTTPEvent.RequestContext.Authorizer.builder()
                    .withJwt(APIGatewayV2HTTPEvent.RequestContext.Authorizer.JWT.builder()
                            .withClaims(Map.of("sub", sub)).build())
                    .build());
        }
        return APIGatewayV2HTTPEvent.builder()
                .withRawPath(path)
                .withRequestContext(ctx.build())
                .withBody(body)
                .withIsBase64Encoded(base64)
                .build();
    }

    private static JsonObject body(APIGatewayV2HTTPResponse res) {
        return JsonParser.parseString(res.getBody()).getAsJsonObject();
    }

    // ---- routing / auth ----

    @Test
    void nullEventReturns401() {
        assertEquals(401, handler().handleRequest(null, null).getStatusCode());
    }

    @Test
    void missingSubClaimReturns401() {
        APIGatewayV2HTTPResponse res = handler()
                .handleRequest(event("GET", "/vocab/due", null, null, false), null);
        assertEquals(401, res.getStatusCode());
        assertEquals("application/json", res.getHeaders().get("content-type"));
    }

    @Test
    void unknownRouteReturns404() {
        APIGatewayV2HTTPResponse res = handler()
                .handleRequest(event("GET", "/vocab/nope", null, SUB, false), null);
        assertEquals(404, res.getStatusCode());
        assertTrue(res.getBody().contains("no such route"));
    }

    // ---- POST /vocab/review ----

    @Test
    void reviewExistingItemSchedulesAndPersists() {
        repo.seed(SUB, "word1", 2.5, 0, 0, "2026-07-01T00:00:00Z", "inima", "heart");
        APIGatewayV2HTTPResponse res = handler().handleRequest(
                event("POST", "/vocab/review", "{\"vocabId\":\"word1\",\"quality\":5}", SUB, false), null);
        assertEquals(200, res.getStatusCode());
        JsonObject b = body(res);
        assertEquals("word1", b.get("vocabId").getAsString());
        assertEquals("2026-08-01T10:00:00Z", b.get("nextReviewAt").getAsString()); // +1 day
        assertEquals(1, b.get("intervalDays").getAsInt());
        assertEquals(1, b.get("repetitions").getAsInt());
        assertEquals(2.6, b.get("easeFactor").getAsDouble(), 1e-9);
        assertFalse(b.get("created").getAsBoolean());

        InMemoryVocabRepository.Stored s = repo.get(SUB, "word1");
        assertEquals("2026-08-01T10:00:00Z", s.nextReviewAt());
        assertEquals(s.nextReviewAt(), s.gsi2sk()); // index key == attribute
        assertEquals("2026-07-31T10:00:00Z", s.lastReviewedAt());
        assertEquals("inima", s.term()); // untouched when body omits term
    }

    @Test
    void secondReviewUsesPersistedState() {
        repo.seed(SUB, "word1", 2.5, 0, 0, "2026-07-01T00:00:00Z", "inima", "heart");
        Handler h = handler();
        h.handleRequest(event("POST", "/vocab/review", "{\"vocabId\":\"word1\",\"quality\":5}", SUB, false), null);
        APIGatewayV2HTTPResponse res = h.handleRequest(
                event("POST", "/vocab/review", "{\"vocabId\":\"word1\",\"quality\":5}", SUB, false), null);
        JsonObject b = body(res);
        assertEquals(2, b.get("repetitions").getAsInt());
        assertEquals(6, b.get("intervalDays").getAsInt());       // SM-2 second-rep interval
        assertEquals("2026-08-06T10:00:00Z", b.get("nextReviewAt").getAsString());
    }

    @Test
    void reviewUnknownItemWithoutTermReturns404() {
        APIGatewayV2HTTPResponse res = handler().handleRequest(
                event("POST", "/vocab/review", "{\"vocabId\":\"ghost\",\"quality\":4}", SUB, false), null);
        assertEquals(404, res.getStatusCode());
        assertTrue(repo.items.isEmpty());
    }

    @Test
    void reviewUnknownItemWithTermCreatesWithSm2Defaults() {
        APIGatewayV2HTTPResponse res = handler().handleRequest(
                event("POST", "/vocab/review",
                        "{\"vocabId\":\"dor\",\"quality\":5,\"term\":\"dor\",\"definition\":\"longing\"}",
                        SUB, false), null);
        assertEquals(200, res.getStatusCode());
        JsonObject b = body(res);
        assertTrue(b.get("created").getAsBoolean());
        assertEquals(1, b.get("repetitions").getAsInt());
        assertEquals(1, b.get("intervalDays").getAsInt());
        assertEquals(2.6, b.get("easeFactor").getAsDouble(), 1e-9); // 2.5 default + q5 bump

        InMemoryVocabRepository.Stored s = repo.get(SUB, "dor");
        assertNotNull(s);
        assertEquals("dor", s.term());
        assertEquals("longing", s.definition());
    }

    @Test
    void reviewQualityOutOfRangeReturns400() {
        repo.seed(SUB, "word1", 2.5, 0, 0, "2026-07-01T00:00:00Z", "inima", "heart");
        APIGatewayV2HTTPResponse res = handler().handleRequest(
                event("POST", "/vocab/review", "{\"vocabId\":\"word1\",\"quality\":7}", SUB, false), null);
        assertEquals(400, res.getStatusCode());
        assertEquals(0, repo.get(SUB, "word1").repetitions()); // untouched
    }

    @Test
    void reviewNonIntegerQualityReturns400() {
        APIGatewayV2HTTPResponse res = handler().handleRequest(
                event("POST", "/vocab/review", "{\"vocabId\":\"word1\",\"quality\":4.5}", SUB, false), null);
        assertEquals(400, res.getStatusCode());
    }

    @Test
    void reviewMissingVocabIdReturns400() {
        APIGatewayV2HTTPResponse res = handler().handleRequest(
                event("POST", "/vocab/review", "{\"quality\":5}", SUB, false), null);
        assertEquals(400, res.getStatusCode());
    }

    @Test
    void reviewMalformedJsonReturns400() {
        APIGatewayV2HTTPResponse res = handler().handleRequest(
                event("POST", "/vocab/review", "not json {", SUB, false), null);
        assertEquals(400, res.getStatusCode());
    }

    @Test
    void reviewBase64EncodedBodyIsDecoded() {
        repo.seed(SUB, "word1", 2.5, 0, 0, "2026-07-01T00:00:00Z", "inima", "heart");
        String b64 = Base64.getEncoder().encodeToString(
                "{\"vocabId\":\"word1\",\"quality\":5}".getBytes(StandardCharsets.UTF_8));
        APIGatewayV2HTTPResponse res = handler().handleRequest(
                event("POST", "/vocab/review", b64, SUB, true), null);
        assertEquals(200, res.getStatusCode());
        assertEquals(1, body(res).get("repetitions").getAsInt());
    }

    @Test
    void persistedInstantsHaveNoSubsecondPrecision() {
        // Mixed-precision ISO strings would break GSI2's lexicographic ordering.
        repo.seed(SUB, "word1", 2.5, 0, 0, "2026-07-01T00:00:00Z", "inima", "heart");
        APIGatewayV2HTTPResponse res = handler(Instant.parse("2026-07-31T10:00:00.123456789Z"))
                .handleRequest(event("POST", "/vocab/review",
                        "{\"vocabId\":\"word1\",\"quality\":5}", SUB, false), null);
        JsonObject b = body(res);
        assertEquals("2026-08-01T10:00:00Z", b.get("nextReviewAt").getAsString());
        assertFalse(repo.get(SUB, "word1").lastReviewedAt().contains("."));
        assertFalse(repo.get(SUB, "word1").gsi2sk().contains("."));
    }

    // ---- GET /vocab/due ----

    @Test
    void dueReturnsPastDueItemsOnlyWithCount() {
        repo.seed(SUB, "due1", 2.5, 1, 0, "2026-07-01T00:00:00Z", "inima", "heart");
        repo.seed(SUB, "future1", 2.5, 30, 5, "2030-01-01T00:00:00Z", "dor", "longing");
        repo.seed("other-user", "due2", 2.5, 1, 0, "2026-07-01T00:00:00Z", "x", "y");
        APIGatewayV2HTTPResponse res = handler()
                .handleRequest(event("GET", "/vocab/due", null, SUB, false), null);
        assertEquals(200, res.getStatusCode());
        JsonObject b = body(res);
        assertEquals(1, b.get("count").getAsInt());
        JsonObject item = b.getAsJsonArray("items").get(0).getAsJsonObject();
        assertEquals("due1", item.get("vocabId").getAsString());
        assertEquals("inima", item.get("term").getAsString());
        assertEquals("heart", item.get("definition").getAsString());
        assertEquals("2026-07-01T00:00:00Z", item.get("nextReviewAt").getAsString());
        assertTrue(item.get("songId").isJsonNull()); // unlinked item -> explicit null
    }

    // ---- 5.4: songId plumbing ----

    @Test
    void reviewCreateWithSongIdPersistsIt() {
        handler().handleRequest(event("POST", "/vocab/review",
                "{\"vocabId\":\"dor\",\"quality\":5,\"term\":\"dor\",\"definition\":\"longing\",\"songId\":\"song-9\"}",
                SUB, false), null);
        assertEquals("song-9", repo.get(SUB, "dor").songId());
    }

    @Test
    void reviewWithoutSongIdPreservesExistingLink() {
        repo.seed(SUB, "word1", 2.5, 0, 0, "2026-07-01T00:00:00Z", "inima", "heart", "song-1");
        handler().handleRequest(event("POST", "/vocab/review",
                "{\"vocabId\":\"word1\",\"quality\":5}", SUB, false), null);
        assertEquals("song-1", repo.get(SUB, "word1").songId());
    }

    @Test
    void duePropagatesSongId() {
        repo.seed(SUB, "word1", 2.5, 1, 0, "2026-07-01T00:00:00Z", "inima", "heart", "song-1");
        APIGatewayV2HTTPResponse res = handler()
                .handleRequest(event("GET", "/vocab/due", null, SUB, false), null);
        JsonObject item = body(res).getAsJsonArray("items").get(0).getAsJsonObject();
        assertEquals("song-1", item.get("songId").getAsString());
    }

    @Test
    void dueEmptyReturnsEmptyArrayAndZeroCount() {
        APIGatewayV2HTTPResponse res = handler()
                .handleRequest(event("GET", "/vocab/due", null, SUB, false), null);
        assertEquals(200, res.getStatusCode());
        JsonObject b = body(res);
        assertEquals(0, b.get("count").getAsInt());
        assertEquals(0, b.getAsJsonArray("items").size());
    }

    // ---- GET /vocab/quiz ----

    @Test
    void quizClozeFromLinkedSong() {
        repo.seed(SUB, "v1", 2.5, 1, 0, "2026-07-01T00:00:00Z", "inima", "heart", "song-1");
        addSong("song-1",
                line(0, "Nu ma parasi acum", "Don't leave me now"),
                line(3, "Inima mea e a ta", "My heart is yours"));
        JsonObject q = quiz().getAsJsonArray("questions").get(0).getAsJsonObject();
        assertEquals("v1", q.get("vocabId").getAsString());
        assertEquals("inima", q.get("term").getAsString());
        assertEquals("heart", q.get("definition").getAsString());
        assertTrue(q.get("hasContext").getAsBoolean());
        assertEquals("song-1", q.get("songId").getAsString());
        assertEquals(3, q.get("lineNumber").getAsInt());
        assertEquals("____ mea e a ta", q.get("prompt").getAsString()); // real line, case-insensitively blanked
        assertEquals("My heart is yours", q.get("translation").getAsString());
    }

    @Test
    void quizFallbackFindsTermAcrossSongsWhenUnlinked() {
        repo.seed(SUB, "v1", 2.5, 1, 0, "2026-07-01T00:00:00Z", "dor", "longing"); // no songId
        addSong("song-a", line(0, "fara cuvantul cautat", "without the sought word"));
        addSong("song-b", line(7, "Mi-e dor de tine", "I miss you"));
        JsonObject q = quiz().getAsJsonArray("questions").get(0).getAsJsonObject();
        assertTrue(q.get("hasContext").getAsBoolean());
        assertEquals("song-b", q.get("songId").getAsString());
        assertEquals("Mi-e ____ de tine", q.get("prompt").getAsString());
    }

    @Test
    void quizFallsBackWhenTermAbsentFromLinkedSong() {
        repo.seed(SUB, "v1", 2.5, 1, 0, "2026-07-01T00:00:00Z", "dor", "longing", "song-a");
        addSong("song-a", line(0, "nimic aici", "nothing here"));
        addSong("song-b", line(2, "Ce dor imi e", "How I long"));
        JsonObject q = quiz().getAsJsonArray("questions").get(0).getAsJsonObject();
        assertTrue(q.get("hasContext").getAsBoolean());
        assertEquals("song-b", q.get("songId").getAsString());
        assertEquals(2, q.get("lineNumber").getAsInt());
    }

    @Test
    void quizNoContextAnywhereStillReturnsTheQuestion() {
        repo.seed(SUB, "v1", 2.5, 1, 0, "2026-07-01T00:00:00Z", "zzzqqx", "nonsense");
        addSong("song-a", line(0, "Inima mea", "My heart"));
        JsonObject b = quiz();
        assertEquals(1, b.get("count").getAsInt());
        JsonObject q = b.getAsJsonArray("questions").get(0).getAsJsonObject();
        assertEquals("zzzqqx", q.get("term").getAsString());
        assertFalse(q.get("hasContext").getAsBoolean());
        assertTrue(q.get("songId").isJsonNull());
        assertTrue(q.get("lineNumber").isJsonNull());
        assertTrue(q.get("prompt").isJsonNull());
        assertTrue(q.get("translation").isJsonNull());
    }

    @Test
    void quizWholeWordOnlyDespiteSubstringPrefilter() {
        // The fake prefilter returns song-a ("in" IS a substring of "inima");
        // the word matcher must still reject it.
        repo.seed(SUB, "v1", 2.5, 1, 0, "2026-07-01T00:00:00Z", "in", "in");
        addSong("song-a", line(0, "inima mea", "my heart"));
        JsonObject q = quiz().getAsJsonArray("questions").get(0).getAsJsonObject();
        assertFalse(q.get("hasContext").getAsBoolean());
    }

    @Test
    void quizBlanksEveryOccurrencePreservingPunctuation() {
        repo.seed(SUB, "v1", 2.5, 1, 0, "2026-07-01T00:00:00Z", "inima", "heart", "song-1");
        addSong("song-1", line(5, "Inima, inima, asta-i inima", "Heart, heart, that's the heart"));
        JsonObject q = quiz().getAsJsonArray("questions").get(0).getAsJsonObject();
        assertEquals("____, ____, asta-i ____", q.get("prompt").getAsString());
    }

    @Test
    void quizMatchesRomanianDiacriticsAcrossCase() {
        repo.seed(SUB, "v1", 2.5, 1, 0, "2026-07-01T00:00:00Z", "iubește", "loves", "song-1");
        addSong("song-1", line(1, "Iubește-mă ca la tine acasă", "Love me like at your home"));
        JsonObject q = quiz().getAsJsonArray("questions").get(0).getAsJsonObject();
        assertTrue(q.get("hasContext").getAsBoolean());
        assertEquals("____-mă ca la tine acasă", q.get("prompt").getAsString());
    }

    @Test
    void quizMultipleDueItemsMostOverdueFirst() {
        repo.seed(SUB, "newer", 2.5, 1, 0, "2026-07-10T00:00:00Z", "dor", "longing", "song-1");
        repo.seed(SUB, "older", 2.5, 1, 0, "2026-06-01T00:00:00Z", "inima", "heart", "song-1");
        addSong("song-1", line(0, "Mi-e dor de inima ta", "I miss your heart"));
        JsonObject b = quiz();
        assertEquals(2, b.get("count").getAsInt());
        assertEquals("older", b.getAsJsonArray("questions").get(0).getAsJsonObject()
                .get("vocabId").getAsString());
    }

    @Test
    void quizEmptyDueReturnsEmptyQuestions() {
        JsonObject b = quiz();
        assertEquals(0, b.get("count").getAsInt());
        assertEquals(0, b.getAsJsonArray("questions").size());
    }

    @Test
    void quizItemWithoutTermHasNoContext() {
        repo.seed(SUB, "v1", 2.5, 1, 0, "2026-07-01T00:00:00Z", null, null);
        JsonObject q = quiz().getAsJsonArray("questions").get(0).getAsJsonObject();
        assertTrue(q.get("term").isJsonNull());
        assertFalse(q.get("hasContext").getAsBoolean());
    }

    @Test
    void quizCapsAtTwentyQuestions() {
        for (int i = 0; i < 25; i++) {
            repo.seed(SUB, "w" + i, 2.5, 1, 0, "2026-07-01T00:00:00Z", "term" + i, "def");
        }
        JsonObject b = quiz();
        assertEquals(20, b.get("count").getAsInt());
        assertEquals(20, b.getAsJsonArray("questions").size());
    }

    @Test
    void reviewThenDueReflectsTheNewSchedule() {
        // The phase's done-when, in miniature: review pushes the item out of due.
        repo.seed(SUB, "word1", 2.5, 1, 0, "2026-07-01T00:00:00Z", "inima", "heart");
        Handler h = handler();
        assertEquals(1, body(h.handleRequest(event("GET", "/vocab/due", null, SUB, false), null))
                .get("count").getAsInt());
        h.handleRequest(event("POST", "/vocab/review", "{\"vocabId\":\"word1\",\"quality\":5}", SUB, false), null);
        assertEquals(0, body(h.handleRequest(event("GET", "/vocab/due", null, SUB, false), null))
                .get("count").getAsInt());
    }
}
