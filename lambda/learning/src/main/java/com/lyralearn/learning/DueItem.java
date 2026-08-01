package com.lyralearn.learning;

/** One due-today vocab row as returned by GET /vocab/due. nextReviewAt stays
 *  the stored ISO-8601 string (no parse/re-format round trip needed). */
public record DueItem(String vocabId, String term, String definition, String nextReviewAt) {}
