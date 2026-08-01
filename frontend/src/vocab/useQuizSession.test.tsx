import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as amplifyAuth from 'aws-amplify/auth'
import * as api from '../api/client'
import type { QuizQuestion } from '../api/types'
import { providersWrapper } from '../test/renderWithProviders'
import { useQuizSession } from './useQuizSession'

vi.mock('aws-amplify/auth')
vi.mock('../api/client')
const mockedAuth = vi.mocked(amplifyAuth)
const mockedApi = vi.mocked(api)

type Session = Awaited<ReturnType<typeof amplifyAuth.fetchAuthSession>>
const session = {
  tokens: { idToken: { toString: () => 'tok', payload: { email: 'x@y.com' } } },
} as unknown as Session

const ctxQ: QuizQuestion = {
  vocabId: 'inimă', term: 'inimă', definition: 'when my heart cries', hasContext: true,
  songId: 'orig0', lineNumber: 3, prompt: 'Când ____ mea plânge', translation: 'When my heart cries',
}
const noCtxQ: QuizQuestion = {
  vocabId: 'dor', term: 'dor', definition: 'longing', hasContext: false,
  songId: null, lineNumber: null, prompt: null, translation: null,
}

describe('useQuizSession', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedAuth.fetchAuthSession.mockResolvedValue(session)
  })

  it('start fetches the quiz once and activates at question 0', async () => {
    mockedApi.getQuiz.mockResolvedValue({ questions: [ctxQ, noCtxQ], count: 2 })
    const { result } = renderHook(() => useQuizSession(), { wrapper: providersWrapper() })
    await act(async () => result.current.start())
    expect(mockedApi.getQuiz).toHaveBeenCalledWith('tok')
    expect(mockedApi.getQuiz).toHaveBeenCalledTimes(1)
    expect(result.current.state).toMatchObject({ phase: 'active', index: 0, revealed: false })
  })

  it('an empty quiz lands in the empty phase', async () => {
    mockedApi.getQuiz.mockResolvedValue({ questions: [], count: 0 })
    const { result } = renderHook(() => useQuizSession(), { wrapper: providersWrapper() })
    await act(async () => result.current.start())
    expect(result.current.state.phase).toBe('empty')
  })

  it('a fetch failure lands in the error phase', async () => {
    mockedApi.getQuiz.mockRejectedValue(new Error('network down'))
    const { result } = renderHook(() => useQuizSession(), { wrapper: providersWrapper() })
    await act(async () => result.current.start())
    expect(result.current.state).toMatchObject({ phase: 'error', message: 'network down' })
  })

  it('answer posts {vocabId, quality} and stores the schedule result', async () => {
    mockedApi.getQuiz.mockResolvedValue({ questions: [ctxQ], count: 1 })
    mockedApi.reviewVocab.mockResolvedValue({
      vocabId: 'inimă', nextReviewAt: '2026-08-02T00:00:00Z',
      intervalDays: 1, repetitions: 1, easeFactor: 2.5, created: false,
    })
    const { result } = renderHook(() => useQuizSession(), { wrapper: providersWrapper() })
    await act(async () => result.current.start())
    act(() => result.current.reveal())
    await act(async () => result.current.answer(4))
    expect(mockedApi.reviewVocab).toHaveBeenCalledWith('tok', { vocabId: 'inimă', quality: 4 })
    expect(result.current.state).toMatchObject({
      phase: 'active',
      result: { nextReviewAt: '2026-08-02T00:00:00Z' },
    })
  })

  it('a failed answer sets answerError and keeps the question gradable', async () => {
    mockedApi.getQuiz.mockResolvedValue({ questions: [ctxQ], count: 1 })
    mockedApi.reviewVocab.mockRejectedValue(new Error('500'))
    const { result } = renderHook(() => useQuizSession(), { wrapper: providersWrapper() })
    await act(async () => result.current.start())
    act(() => result.current.reveal())
    await act(async () => result.current.answer(4))
    expect(result.current.state).toMatchObject({ phase: 'active', answerError: true, result: null })
  })

  it('next advances through questions and finishes into done', async () => {
    mockedApi.getQuiz.mockResolvedValue({ questions: [ctxQ, noCtxQ], count: 2 })
    const { result } = renderHook(() => useQuizSession(), { wrapper: providersWrapper() })
    await act(async () => result.current.start())
    act(() => result.current.next())
    expect(result.current.state).toMatchObject({ phase: 'active', index: 1, revealed: false })
    act(() => result.current.next())
    expect(result.current.state).toEqual({ phase: 'done', total: 2 })
  })
})
