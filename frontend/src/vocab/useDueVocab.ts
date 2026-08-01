import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { getDueVocab } from '../api/client'
import type { DueVocabResponse } from '../api/types'
import { useAuth } from '../auth/AuthContext'

// Short staleTime: the list drifts as time passes and as reviews land.
// useReviewVocab invalidates ['vocab', 'due'] after every successful review,
// so the badge and list refresh immediately without waiting out staleness.
export function useDueVocab(): UseQueryResult<DueVocabResponse, Error> {
  const { status, getIdToken } = useAuth()
  return useQuery({
    queryKey: ['vocab', 'due'],
    queryFn: async () => getDueVocab(await getIdToken()),
    staleTime: 30_000,
    // Vocab is per-user; signed-out visitors have no due list (Phase 7: the
    // shell renders for everyone, so this hook now mounts signed-out too).
    enabled: status === 'signedIn',
  })
}
