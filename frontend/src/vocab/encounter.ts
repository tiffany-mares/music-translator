import type { LyricsDoc, ReviewRequest } from '../api/types'

// Strip leading/trailing non-letter/digit (punctuation, quotes, dashes).
// Interior characters survive: "n-am" stays "n-am".
const EDGE_JUNK = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu

export function extractTerm(raw: string): string {
  return raw.replace(EDGE_JUNK, '')
}

// Stable identity: re-encountering the same word (any casing/punctuation)
// maps to the same vocab item — the review just re-schedules it.
export function toVocabId(term: string): string {
  return term.toLowerCase()
}

// null = nothing worth saving (punctuation-only token or bad indices).
// quality 0 = "new word": SM-2 failure branch — interval 1, reps 0, EF
// untouched — so an encounter comes due tomorrow. definition falls back to ''
// when the line has no translation (per-word translations don't exist, the
// line translation is the best context).
export function buildEncounter(
  doc: LyricsDoc,
  lineIndex: number,
  wordIndex: number,
): ReviewRequest | null {
  const line = doc.lines[lineIndex]
  const word = line?.words[wordIndex]
  if (!word) return null
  const term = extractTerm(word.text)
  if (!term) return null
  return {
    vocabId: toVocabId(term),
    quality: 0,
    term,
    definition: line.translatedText ?? '',
    songId: doc.songId,
  }
}
