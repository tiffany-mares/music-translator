import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as amplifyAuth from 'aws-amplify/auth'
import * as api from '../api/client'
import type { ReviewResult } from '../api/types'
import { providersWrapper } from '../test/renderWithProviders'
import { useDueVocab } from './useDueVocab'
import { useReviewVocab } from './useReviewVocab'

vi.mock('aws-amplify/auth')
vi.mock('../api/client')
const mockedAuth = vi.mocked(amplifyAuth)
const mockedApi = vi.mocked(api)

type Session = Awaited<ReturnType<typeof amplifyAuth.fetchAuthSession>>
const session = {
  tokens: { idToken: { toString: () => 'tok', payload: { email: 'x@y.com' } } },
} as unknown as Session

const scheduled: ReviewResult = {
  vocabId: 'dor', nextReviewAt: '2026-08-02T00:00:00Z',
  intervalDays: 1, repetitions: 1, easeFactor: 2.5, created: false,
}

describe('useReviewVocab', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedAuth.fetchAuthSession.mockResolvedValue(session)
  })

  it('POSTs the review with the token and resolves the schedule', async () => {
    mockedApi.reviewVocab.mockResolvedValue(scheduled)
    const { result } = renderHook(() => useReviewVocab(), { wrapper: providersWrapper() })
    let res: ReviewResult | undefined
    await act(async () => {
      res = await result.current.mutateAsync({ vocabId: 'dor', quality: 4 })
    })
    expect(mockedApi.reviewVocab).toHaveBeenCalledWith('tok', { vocabId: 'dor', quality: 4 })
    expect(res).toEqual(scheduled)
  })

  it('invalidates the due list on success', async () => {
    // Shared wrapper (one QueryClient) so the mutation's invalidation hits
    // the SAME cache the due query lives in.
    const wrapper = providersWrapper()
    mockedApi.getDueVocab.mockResolvedValue({ items: [], count: 0 })
    mockedApi.reviewVocab.mockResolvedValue(scheduled)
    const due = renderHook(() => useDueVocab(), { wrapper })
    await waitFor(() => expect(due.result.current.isSuccess).toBe(true))
    const review = renderHook(() => useReviewVocab(), { wrapper })
    await act(async () => {
      await review.result.current.mutateAsync({ vocabId: 'dor', quality: 4 })
    })
    await waitFor(() => expect(mockedApi.getDueVocab).toHaveBeenCalledTimes(2))
  })
})
