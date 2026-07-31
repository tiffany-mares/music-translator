import { describe, expect, it } from 'vitest'
import type { LyricsLine, LyricsWord } from '../api/types'
import { activeWordAt, flattenWords, type FlatWord } from './wordSync'

function w(text: string, start: number, end: number): LyricsWord {
  return { text, start, end }
}

function line(lineNumber: number, words: LyricsWord[]): LyricsLine {
  return {
    lineNumber,
    originalText: words.map((x) => x.text).join(' '),
    translatedText: null,
    startTime: words[0]?.start ?? 0,
    endTime: words[words.length - 1]?.end ?? 0,
    words,
  }
}

describe('flattenWords', () => {
  it('flattens nested words with line/word indices, sorted by start', () => {
    const flat = flattenWords([
      line(1, [w('a', 1.0, 1.4), w('b', 1.5, 1.9)]),
      line(2, [w('c', 2.5, 2.8)]),
    ])
    expect(flat).toEqual([
      { lineIndex: 0, wordIndex: 0, start: 1.0, end: 1.4 },
      { lineIndex: 0, wordIndex: 1, start: 1.5, end: 1.9 },
      { lineIndex: 1, wordIndex: 0, start: 2.5, end: 2.8 },
    ])
  })

  it('returns [] for empty lines', () => {
    expect(flattenWords([])).toEqual([])
  })

  it('tolerates words: [] lines (structurally valid per contract)', () => {
    const flat = flattenWords([line(1, []), line(2, [w('x', 3, 3.5)]), line(3, [])])
    expect(flat).toEqual([{ lineIndex: 1, wordIndex: 0, start: 3, end: 3.5 }])
  })

  it('sorts unsorted input by start (stitch-seam insurance)', () => {
    const flat = flattenWords([line(1, [w('late', 5, 5.5)]), line(2, [w('early', 1, 1.5)])])
    expect(flat.map((f) => f.start)).toEqual([1, 5])
    expect(flat[0].lineIndex).toBe(1)
  })
})

// Words at [1.0,1.4], [1.5,1.9], [2.5,2.8] - a micro-gap and a long gap.
const FIXTURE: FlatWord[] = [
  { lineIndex: 0, wordIndex: 0, start: 1.0, end: 1.4 },
  { lineIndex: 0, wordIndex: 1, start: 1.5, end: 1.9 },
  { lineIndex: 1, wordIndex: 0, start: 2.5, end: 2.8 },
]

describe('activeWordAt', () => {
  it('returns -1 for an empty array', () => {
    expect(activeWordAt([], 1.2)).toBe(-1)
  })

  it('returns -1 before the first word starts', () => {
    expect(activeWordAt(FIXTURE, 0)).toBe(-1)
    expect(activeWordAt(FIXTURE, 0.999)).toBe(-1)
  })

  it('activates a word at exactly its start (start <= t)', () => {
    expect(activeWordAt(FIXTURE, 1.0)).toBe(0)
  })

  it('returns the containing word mid-word', () => {
    expect(activeWordAt(FIXTURE, 1.7)).toBe(1)
  })

  it('persists the highlight through the gap after a word ends', () => {
    expect(activeWordAt(FIXTURE, 1.45)).toBe(0) // micro-gap 1.4-1.5
    expect(activeWordAt(FIXTURE, 2.0)).toBe(1) // long gap 1.9-2.5
    expect(activeWordAt(FIXTURE, 2.499)).toBe(1)
  })

  it('hands off at exactly the next word start', () => {
    expect(activeWordAt(FIXTURE, 2.5)).toBe(2)
  })

  it('keeps the last word active until its own end', () => {
    expect(activeWordAt(FIXTURE, 2.79)).toBe(2)
  })

  it('clears after the last word ends (instrumental outro)', () => {
    expect(activeWordAt(FIXTURE, 2.8)).toBe(-1)
    expect(activeWordAt(FIXTURE, 60)).toBe(-1)
  })

  it('matches a linear scan across a 500-word array', () => {
    const flat: FlatWord[] = Array.from({ length: 500 }, (_, i) => ({
      lineIndex: Math.floor(i / 8),
      wordIndex: i % 8,
      start: i * 0.5,
      end: i * 0.5 + 0.4,
    }))
    const linear = (t: number) => {
      let idx = -1
      for (let i = 0; i < flat.length; i++) if (flat[i].start <= t) idx = i
      if (idx === flat.length - 1 && t >= flat[idx].end) return -1
      return idx
    }
    for (let t = -1; t < 260; t += 0.13) {
      expect(activeWordAt(flat, t)).toBe(linear(t))
    }
  })
})
