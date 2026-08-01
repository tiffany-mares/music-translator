package com.lyralearn.learning;

/** One section-6.2 lyrics line, marshalled out of the Mongo doc. */
public record LyricLine(int lineNumber, String originalText, String translatedText) {}
