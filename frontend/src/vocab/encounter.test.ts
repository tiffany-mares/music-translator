import { describe, expect, it } from 'vitest'
import type { LyricsDoc } from '../api/types'
import { buildEncounter, extractTerm, toVocabId } from './encounter'

const doc: LyricsDoc = {
  songId: 'orig0',
  sourceLanguage: 'ro',
  targetLanguage: 'en',
  lines: [
    {
      lineNumber: 1,
      originalText: 'Inimă, cântă!',
      translatedText: 'Heart, sing!',
      startTime: 1,
      endTime: 2,
      words: [
        { text: 'Inimă,', start: 1, end: 1.4 },
        { text: 'cântă!', start: 1.5, end: 2 },
      ],
    },
    {
      lineNumber: 2,
      originalText: '— la la',
      translatedText: null,
      startTime: 3,
      endTime: 4,
      words: [
        { text: '—', start: 3, end: 3.2 },
        { text: 'la', start: 3.3, end: 3.6 },
      ],
    },
  ],
}

describe('extractTerm', () => {
  it('strips leading/trailing punctuation but keeps interior characters', () => {
    expect(extractTerm('Inimă,')).toBe('Inimă')
    expect(extractTerm('«Salut»')).toBe('Salut')
    expect(extractTerm('(n-am)')).toBe('n-am')
    expect(extractTerm('cântă!')).toBe('cântă')
  })

  it('returns empty for punctuation-only tokens', () => {
    expect(extractTerm('—')).toBe('')
    expect(extractTerm('...')).toBe('')
  })
})

describe('toVocabId', () => {
  it('lowercases including diacritics', () => {
    expect(toVocabId('Inimă')).toBe('inimă')
    expect(toVocabId('DOR')).toBe('dor')
  })
})

describe('buildEncounter', () => {
  it('builds a quality-0 create payload from the word and its line translation', () => {
    expect(buildEncounter(doc, 0, 0)).toEqual({
      vocabId: 'inimă',
      quality: 0,
      term: 'Inimă',
      definition: 'Heart, sing!',
      songId: 'orig0',
    })
  })

  it('falls back to an empty definition when the line has no translation', () => {
    expect(buildEncounter(doc, 1, 1)).toMatchObject({ vocabId: 'la', definition: '' })
  })

  it('returns null for punctuation-only tokens and out-of-range indices', () => {
    expect(buildEncounter(doc, 1, 0)).toBeNull() // "—"
    expect(buildEncounter(doc, 5, 0)).toBeNull()
    expect(buildEncounter(doc, 0, 9)).toBeNull()
  })
})
