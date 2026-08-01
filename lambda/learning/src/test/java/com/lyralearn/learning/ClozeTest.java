package com.lyralearn.learning;

import org.junit.jupiter.api.Test;

import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ClozeTest {

    @Test
    void matchesWholeWordCaseInsensitively() {
        assertTrue(Cloze.wordPattern("inima").matcher("Inima mea").find());
        assertTrue(Cloze.wordPattern("INIMA").matcher("da, inima!").find());
    }

    @Test
    void doesNotMatchInsideALargerWord() {
        assertFalse(Cloze.wordPattern("in").matcher("inima mea").find());
        assertFalse(Cloze.wordPattern("ini").matcher("inima").find());
    }

    @Test
    void unicodeCaseFoldsRomanianDiacritics() {
        assertTrue(Cloze.wordPattern("și").matcher("ȘI vino").find());
        assertTrue(Cloze.wordPattern("Țară").matcher("in țară straina").find());
        // suffix "și" of "totuși" is guarded by the letter lookbehind
        assertFalse(Cloze.wordPattern("și").matcher("totuși").find());
    }

    @Test
    void doesNotFoldDiacriticsAway() {
        // Pinned decision: terms come from lyrics verbatim (5.5), so no ă/a folding.
        assertFalse(Cloze.wordPattern("inima").matcher("inimă mea").find());
    }

    @Test
    void regexMetacharactersInTermAreLiteral() {
        Pattern p = Cloze.wordPattern("ce-i (oare)?");
        assertTrue(p.matcher("stiu ce-i (oare)? nu stiu").find());
        assertFalse(p.matcher("ce-i X").find());
    }

    @Test
    void blankReplacesEveryOccurrencePreservingPunctuation() {
        Pattern p = Cloze.wordPattern("inima");
        assertEquals("____, ____, asta-i ____", Cloze.blank("Inima, inima, asta-i inima", p));
    }
}
