package com.lyralearn.learning;

import java.util.List;
import java.util.Optional;

/**
 * 5.4 lyrics seam. Returns RAW lines only - whole-word matching and cloze
 * blanking live in QuizService/Cloze (unit-tested), never in a Mongo query
 * (server-side PCRE \b is not Unicode-aware for ă/ș/ț). The Mongo impl stays
 * thin and is proven live by scripts/verify_5_4.sh.
 */
public interface LyricsRepository {

    /** The section-6.2 doc for songId, empty if the song was never processed. */
    Optional<SongLyrics> findBySongId(String songId);

    /**
     * Case-insensitive SUBSTRING prefilter on lines.originalText - the
     * spec-anticipated "find songs containing word X" pattern. May return
     * false positives ("in" matches "inima"); callers re-check with the real
     * word matcher. Cannot false-negative: a whole-word hit is a substring hit.
     */
    List<SongLyrics> findByTermSubstring(String term);
}
