import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query'
import { getAudioUrls } from '../api/client'
import type { AudioUrls } from '../api/types'
import { useAuth } from '../auth/AuthContext'

// Presigned GET URLs live 900s. staleTime sits just under that so a focus or
// remount after a long idle mints fresh URLs; normal renders reuse the cache.
// Expiry MID-playback is handled by Player's onError + Reload track since 4.5.
const STALE_MS = 13 * 60 * 1000

export function useAudioUrls(
  songId: string | null,
  pipelineDone: boolean,
): UseQueryResult<AudioUrls, Error> {
  const { getIdToken } = useAuth()
  return useQuery({
    // pipelineDone in the key forces exactly one refetch when the job hits
    // COMPLETE - by then WriteAudioKeys has published vocals/noVocals. On the
    // linked path pipelineDone is true from the start: a single fetch, since
    // linked songs already carry whatever stems they will ever have.
    queryKey: ['audioUrls', songId, pipelineDone],
    enabled: songId !== null,
    queryFn: async () => getAudioUrls(await getIdToken(), songId!),
    // Bridge the key change so the player never loses data mid-refetch.
    placeholderData: keepPreviousData,
    staleTime: STALE_MS,
  })
}
