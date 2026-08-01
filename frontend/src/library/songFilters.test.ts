import { describe, expect, it } from 'vitest'
import type { SongListing } from '../api/types'
import { distinctLanguages, filterByLanguage } from './songFilters'

const song = (songId: string, sourceLanguage: string | null): SongListing => ({
  songId,
  title: songId,
  artist: 'a',
  status: 'VALIDATED',
  createdAt: '2026-07-01T00:00:00+00:00',
  sourceLanguage,
})

describe('distinctLanguages', () => {
  it('returns the sorted unique languages, ignoring nulls', () => {
    const songs = [song('a', 'ro'), song('b', 'fr'), song('c', 'ro'), song('d', null)]
    expect(distinctLanguages(songs)).toEqual(['fr', 'ro'])
  })

  it('is empty when no song has a language', () => {
    expect(distinctLanguages([song('a', null)])).toEqual([])
  })
})

describe('filterByLanguage', () => {
  const songs = [song('a', 'ro'), song('b', 'fr'), song('c', null)]

  it('null filter returns everything (All languages)', () => {
    expect(filterByLanguage(songs, null)).toEqual(songs)
  })

  it('a language keeps only exact matches', () => {
    expect(filterByLanguage(songs, 'ro').map((s) => s.songId)).toEqual(['a'])
  })
})
