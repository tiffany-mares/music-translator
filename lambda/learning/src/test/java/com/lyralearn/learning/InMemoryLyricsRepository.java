package com.lyralearn.learning;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

/** In-memory LyricsRepository mirroring the Mongo impl's semantics:
 *  case-insensitive SUBSTRING prefilter (may false-positive), raw lines out. */
class InMemoryLyricsRepository implements LyricsRepository {

    final List<SongLyrics> songs = new ArrayList<>();

    void add(SongLyrics s) {
        songs.add(s);
    }

    @Override
    public Optional<SongLyrics> findBySongId(String songId) {
        return songs.stream().filter(s -> s.songId().equals(songId)).findFirst();
    }

    @Override
    public List<SongLyrics> findByTermSubstring(String term) {
        String needle = term.toLowerCase(Locale.ROOT);
        return songs.stream()
                .filter(s -> s.lines().stream().anyMatch(
                        l -> l.originalText().toLowerCase(Locale.ROOT).contains(needle)))
                .toList();
    }
}
