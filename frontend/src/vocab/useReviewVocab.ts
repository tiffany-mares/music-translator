import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query'
import { reviewVocab } from '../api/client'
import type { ReviewRequest, ReviewResult } from '../api/types'
import { useAuth } from '../auth/AuthContext'

// The codebase's first useMutation — deliberate: unlike useUploadFlow's
// multi-step orchestration, a review is a single POST whose pending/error/
// data lifecycle plus cache invalidation is exactly what useMutation models.
// Shared by both callers of POST /vocab/review: word-encounter saves
// (WordSyncedLyrics, with term/definition/songId) and quiz answers
// (useQuizSession, vocabId+quality only). Invalidating the due list on every
// success keeps the badge/list fresh even if a quiz session is abandoned.
export function useReviewVocab(): UseMutationResult<ReviewResult, Error, ReviewRequest> {
  const { getIdToken } = useAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (req: ReviewRequest) => reviewVocab(await getIdToken(), req),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['vocab', 'due'] })
    },
  })
}
