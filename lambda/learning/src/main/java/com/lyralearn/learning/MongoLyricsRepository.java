package com.lyralearn.learning;

import com.mongodb.ConnectionString;
import com.mongodb.MongoClientSettings;
import com.mongodb.client.MongoClient;
import com.mongodb.client.MongoClients;
import com.mongodb.client.MongoCollection;
import com.mongodb.client.model.Filters;
import com.mongodb.client.model.Projections;
import org.bson.Document;
import org.bson.conversions.Bson;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import software.amazon.awssdk.services.secretsmanager.SecretsManagerClient;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;

/**
 * lyralearn.lyrics on Atlas, Document API only (no POJO codecs = no
 * reflection, shade-safe). Thin by design - marshalling plus the substring
 * prefilter; proven live by scripts/verify_5_4.sh, all logic unit-tested
 * against InMemoryLyricsRepository.
 *
 * The MongoClient is LAZY (first quiz call), so /vocab/review + /vocab/due
 * cold starts pay nothing for Mongo. Client + secret are cached for the
 * lifetime of the execution environment (python precedent: lambda/api).
 */
public class MongoLyricsRepository implements LyricsRepository {

    private static final int MAX_SONGS = 5; // fallback prefilter cap; M0 collection is tiny

    private static final Bson PROJECTION = Projections.fields(
            Projections.excludeId(),
            Projections.include("songId", "lines.lineNumber",
                    "lines.originalText", "lines.translatedText"));

    private final Supplier<String> uriSupplier;
    private volatile MongoClient client;

    MongoLyricsRepository(Supplier<String> uriSupplier) {
        this.uriSupplier = uriSupplier;
    }

    /** SecretString of lyralearn/mongodb IS the raw mongodb+srv URI (3.5 convention). */
    static MongoLyricsRepository fromSecretsManager() {
        return new MongoLyricsRepository(() -> {
            String arn = System.getenv("MONGODB_SECRET_ARN");
            if (arn == null || arn.isBlank()) {
                throw new IllegalStateException("MONGODB_SECRET_ARN is not set");
            }
            try (SecretsManagerClient sm = SecretsManagerClient.builder()
                    .httpClient(UrlConnectionHttpClient.create())
                    .build()) {
                return sm.getSecretValue(b -> b.secretId(arn)).secretString();
            }
        });
    }

    private MongoCollection<Document> lyrics() {
        MongoClient c = client;
        if (c == null) {
            synchronized (this) {
                if (client == null) {
                    // Same knobs as the python API Lambda: fail fast, small pool.
                    client = MongoClients.create(MongoClientSettings.builder()
                            .applyConnectionString(new ConnectionString(uriSupplier.get()))
                            .applyToClusterSettings(b -> b.serverSelectionTimeout(5, TimeUnit.SECONDS))
                            .applyToSocketSettings(b -> b.connectTimeout(5, TimeUnit.SECONDS))
                            .applyToConnectionPoolSettings(b -> b.maxSize(5))
                            .build());
                }
                c = client;
            }
        }
        return c.getDatabase("lyralearn").getCollection("lyrics");
    }

    @Override
    public Optional<SongLyrics> findBySongId(String songId) {
        Document doc = lyrics().find(Filters.eq("songId", songId))
                .projection(PROJECTION).first();
        return Optional.ofNullable(doc).map(MongoLyricsRepository::toSongLyrics);
    }

    @Override
    public List<SongLyrics> findByTermSubstring(String term) {
        // Substring-only prefilter, term escaped to a PCRE literal. Word
        // boundaries are deliberately NOT expressed here (see interface doc).
        Bson filter = Filters.regex("lines.originalText", escapeRegex(term), "i");
        List<SongLyrics> out = new ArrayList<>();
        for (Document doc : lyrics().find(filter).projection(PROJECTION).limit(MAX_SONGS)) {
            out.add(toSongLyrics(doc));
        }
        return out;
    }

    private static SongLyrics toSongLyrics(Document doc) {
        List<LyricLine> lines = new ArrayList<>();
        for (Document l : doc.getList("lines", Document.class, List.of())) {
            String original = l.getString("originalText");
            if (original == null) continue; // defensive: unmatchable line
            Number n = (Number) l.get("lineNumber");
            lines.add(new LyricLine(n == null ? -1 : n.intValue(),
                    original, l.getString("translatedText")));
        }
        return new SongLyrics(doc.getString("songId"), lines);
    }

    /** Escape PCRE metacharacters explicitly (\Q..\E is Java-flavored; don't rely on it server-side). */
    static String escapeRegex(String s) {
        StringBuilder sb = new StringBuilder(s.length() + 4);
        for (char ch : s.toCharArray()) {
            if ("\\^$.|?*+()[]{}".indexOf(ch) >= 0) {
                sb.append('\\');
            }
            sb.append(ch);
        }
        return sb.toString();
    }
}
