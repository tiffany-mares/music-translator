import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as amplifyAuth from 'aws-amplify/auth'
import * as api from '../api/client'
import { providersWrapper } from '../test/renderWithProviders'
import { useDueVocab } from './useDueVocab'

vi.mock('aws-amplify/auth')
vi.mock('../api/client')
const mockedAuth = vi.mocked(amplifyAuth)
const mockedApi = vi.mocked(api)

type Session = Awaited<ReturnType<typeof amplifyAuth.fetchAuthSession>>
const session = {
  tokens: { idToken: { toString: () => 'tok', payload: { email: 'x@y.com' } } },
} as unknown as Session

describe('useDueVocab', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedAuth.fetchAuthSession.mockResolvedValue(session)
  })

  it('fetches the due list with a fresh ID token', async () => {
    mockedApi.getDueVocab.mockResolvedValue({
      items: [{ vocabId: 'dor', term: 'dor', definition: 'longing', songId: 's1', nextReviewAt: '2026-01-01T00:00:00Z' }],
      count: 1,
    })
    const { result } = renderHook(() => useDueVocab(), { wrapper: providersWrapper() })
    await waitFor(() => expect(result.current.data?.count).toBe(1))
    expect(mockedApi.getDueVocab).toHaveBeenCalledWith('tok')
  })

  it('surfaces fetch errors', async () => {
    mockedApi.getDueVocab.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useDueVocab(), { wrapper: providersWrapper() })
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
