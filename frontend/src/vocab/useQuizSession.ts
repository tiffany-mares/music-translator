import { useCallback, useState } from 'react'
import { getQuiz } from '../api/client'
import type { QuizQuestion, ReviewResult } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { useReviewVocab } from './useReviewVocab'

export type QuizSessionState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'empty' }
  | {
      phase: 'active'
      questions: QuizQuestion[]
      index: number
      revealed: boolean
      result: ReviewResult | null // set once this question has been graded
      answerError: boolean
    }
  | { phase: 'done'; total: number }

// The quiz is fetched IMPERATIVELY (the useUploadFlow precedent), not via
// useQuery: a session is a one-shot snapshot indexed through locally — caching
// it would invite mid-session refetches (every answer invalidates vocab
// queries) for zero reuse value. Answers go through useReviewVocab, so the
// due list/badge refresh after each grade, even on an abandoned session.
export function useQuizSession() {
  const { getIdToken } = useAuth()
  const review = useReviewVocab()
  const [state, setState] = useState<QuizSessionState>({ phase: 'idle' })

  const start = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const quiz = await getQuiz(await getIdToken())
      if (quiz.questions.length === 0) {
        setState({ phase: 'empty' })
      } else {
        setState({
          phase: 'active',
          questions: quiz.questions,
          index: 0,
          revealed: false,
          result: null,
          answerError: false,
        })
      }
    } catch (err) {
      setState({
        phase: 'error',
        message: err instanceof Error ? err.message : 'Quiz failed to load',
      })
    }
  }, [getIdToken])

  const reveal = useCallback(() => {
    setState((s) => (s.phase === 'active' ? { ...s, revealed: true } : s))
  }, [])

  const answer = useCallback(
    async (quality: number) => {
      if (state.phase !== 'active' || state.result !== null) return
      const { vocabId } = state.questions[state.index]
      try {
        const result = await review.mutateAsync({ vocabId, quality })
        setState((s) => (s.phase === 'active' ? { ...s, result, answerError: false } : s))
      } catch {
        setState((s) => (s.phase === 'active' ? { ...s, answerError: true } : s))
      }
    },
    [state, review],
  )

  const next = useCallback(() => {
    setState((s) => {
      if (s.phase !== 'active') return s
      const index = s.index + 1
      if (index >= s.questions.length) return { phase: 'done', total: s.questions.length }
      return { ...s, index, revealed: false, result: null, answerError: false }
    })
  }, [])

  return { state, start, reveal, answer, next, answering: review.isPending }
}
