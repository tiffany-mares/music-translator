import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { getAllVocab } from '../api/client'
import type { DueVocabResponse } from '../api/types'
import { useAuth } from '../auth/AuthContext'

// The whole collection, fetched only when the Review view actually shows it
// (nothing due). Reviews invalidate ['vocab'] prefixes via useReviewVocab, so
// a graded word's fresh nextReviewAt shows up on the next look.
export function useAllVocab(enabled: boolean): UseQueryResult<DueVocabResponse, Error> {
  const { status, getIdToken } = useAuth()
  return useQuery({
    queryKey: ['vocab', 'all'],
    queryFn: async () => getAllVocab(await getIdToken()),
    staleTime: 30_000,
    enabled: enabled && status === 'signedIn',
  })
}
