package com.lyralearn.learning;

import java.util.regex.Pattern;

/**
 * 5.4: whole-word, case-insensitive term matching for cloze prompts.
 * Boundaries are letter/digit lookarounds (not \b - Romanian diacritics are
 * letters); UNICODE_CASE makes I/i and Ă/ă/Ș/ș fold. Deliberately NO
 * diacritic folding ("inima" != "inimă") - terms come from lyrics verbatim
 * via 5.5's create-on-encounter, so they match exactly.
 */
final class Cloze {

    static final String BLANK = "____";

    private Cloze() {}

    static Pattern wordPattern(String term) {
        return Pattern.compile(
                "(?<![\\p{L}\\p{N}])" + Pattern.quote(term) + "(?![\\p{L}\\p{N}])",
                Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
    }

    /** Replace EVERY occurrence (a single blank would leak the answer elsewhere in the line). */
    static String blank(String line, Pattern wordPattern) {
        return wordPattern.matcher(line).replaceAll(BLANK);
    }
}
