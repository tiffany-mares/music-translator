package com.lyralearn.learning;

import java.util.List;

/** The lines of one processed song (section 6.2 doc, word timings dropped). */
public record SongLyrics(String songId, List<LyricLine> lines) {}
