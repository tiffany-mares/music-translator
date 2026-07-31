import type { LyricsLine } from '../api/types'

export interface FlatWord {
  lineIndex: number
  wordIndex: number
  start: number
  end: number
}

// Flattens the 6.2 nested lines->words shape into one array sorted by start.
// Sorting is cheap insurance: stitch-seam merges have produced ordering quirks
// before (notes/phase2.md 2.5), and activeWordAt's binary search is only
// correct over sorted input. Array.prototype.sort is stable, so equal starts
// keep document order.
export function flattenWords(lines: LyricsLine[]): FlatWord[] {
  const flat: FlatWord[] = []
  lines.forEach((line, lineIndex) => {
    line.words.forEach((w, wordIndex) => {
      flat.push({ lineIndex, wordIndex, start: w.start, end: w.end })
    })
  })
  return flat.sort((a, b) => a.start - b.start)
}

// Active-word semantics: a word is active from its start until the NEXT word's
// start ("highlight persists until the next word starts"). Whisper word timings
// leave micro-gaps between nearly every word; strict [start, end) would strobe
// the highlight off dozens of times per line. The only place persistence looks
// wrong is after the FINAL word (instrumental outro), so that one case clears
// at its own end. Returns -1 before the first word, after the last word ends,
// or for an empty array. O(log n): greatest i with flat[i].start <= t.
export function activeWordAt(flat: FlatWord[], t: number): number {
  if (flat.length === 0 || t < flat[0].start) return -1
  let lo = 0
  let hi = flat.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (flat[mid].start <= t) lo = mid
    else hi = mid - 1
  }
  if (lo === flat.length - 1 && t >= flat[lo].end) return -1
  return lo
}
