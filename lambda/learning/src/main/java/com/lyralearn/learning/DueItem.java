package com.lyralearn.learning;

/** One due-today vocab row as returned by GET /vocab/due (and fed to the quiz).
 *  nextReviewAt stays the stored ISO-8601 string (no parse/re-format round
 *  trip). songId is the 5.4 lyric-context link - null for unlinked items. */
public record DueItem(String vocabId, String term, String definition,
                      String songId, String nextReviewAt) {}
