import type { SongListing } from '../api/types'

// Client-side filtering is deliberate: the catalog is small (revisit with a
// server-side filter param only if it outgrows a single response).

export function distinctLanguages(songs: SongListing[]): string[] {
  return [...new Set(songs.map((s) => s.sourceLanguage).filter((l): l is string => l !== null))].sort()
}

export function filterByLanguage(songs: SongListing[], language: string | null): SongListing[] {
  if (language === null) return songs
  return songs.filter((s) => s.sourceLanguage === language)
}
