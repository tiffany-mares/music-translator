import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as amplifyAuth from 'aws-amplify/auth'
import * as api from '../api/client'
import type { Job } from '../api/types'
import { providersWrapper } from '../test/renderWithProviders'
import { useJobPolling } from './useJobPolling'

vi.mock('aws-amplify/auth')
vi.mock('../api/client')
const mockedAuth = vi.mocked(amplifyAuth)
const mockedApi = vi.mocked(api)

type Session = Awaited<ReturnType<typeof amplifyAuth.fetchAuthSession>>
const session = {
  tokens: { idToken: { toString: () => 'tok', payload: { email: 'x@y.com' } } },
} as unknown as Session

describe('useJobPolling', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedAuth.fetchAuthSession.mockResolvedValue(session)
  })

  it('fetches the job with a fresh ID token', async () => {
    const job: Job = { jobId: 's1.aaaa', songId: 's1', status: 'QUEUED' }
    mockedApi.getJob.mockResolvedValue(job)
    const { result } = renderHook(() => useJobPolling('s1.aaaa'), { wrapper: providersWrapper() })
    await waitFor(() => expect(result.current.data).toEqual(job))
    expect(mockedApi.getJob).toHaveBeenCalledWith('tok', 's1.aaaa')
  })

  it('does not fetch when jobId is null', async () => {
    renderHook(() => useJobPolling(null), { wrapper: providersWrapper() })
    await new Promise((r) => setTimeout(r, 50))
    expect(mockedApi.getJob).not.toHaveBeenCalled()
  })
})
