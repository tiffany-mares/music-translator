import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { getLyrics } from '../api/client'
import type { LyricsDoc } from '../api/types'
import { useAuth } from '../auth/AuthContext'

// Deliberately NOT the useAudioUrls key-flip pattern: audio-urls exists from
// upload time and must be RE-fetched at COMPLETE to discover stems, so
// pipelineDone lives in its queryKey. The lyrics doc 404s for the entire
// QUEUED/PROCESSING window and is immutable afterwards - so pipelineDone is
// the `enabled` gate (never fetch into the 404 window), the key is just the
// songId, and staleTime: Infinity makes it exactly one fetch, cached forever.
// The default retry absorbs a transient error at the COMPLETE boundary.
export function useLyrics(
  songId: string | null,
  pipelineDone: boolean,
): UseQueryResult<LyricsDoc, Error> {
  const { getOptionalIdToken } = useAuth()
  return useQuery({
    queryKey: ['lyrics', songId],
    enabled: songId !== null && pipelineDone,
    queryFn: async () => getLyrics(await getOptionalIdToken(), songId!),
    staleTime: Infinity,
  })
}
