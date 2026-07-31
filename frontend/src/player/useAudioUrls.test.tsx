import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as amplifyAuth from 'aws-amplify/auth'
import * as api from '../api/client'
import type { AudioUrls } from '../api/types'
import { providersWrapper } from '../test/renderWithProviders'
import { useAudioUrls } from './useAudioUrls'

vi.mock('aws-amplify/auth')
vi.mock('../api/client')
const mockedAuth = vi.mocked(amplifyAuth)
const mockedApi = vi.mocked(api)

type Session = Awaited<ReturnType<typeof amplifyAuth.fetchAuthSession>>
const session = {
  tokens: { idToken: { toString: () => 'tok', payload: { email: 'x@y.com' } } },
} as unknown as Session

const rawOnly: AudioUrls = { urls: { raw: 'https://s3/raw?a' }, expiresInSeconds: 900 }
const allStems: AudioUrls = {
  urls: { raw: 'https://s3/raw?b', vocals: 'https://s3/v?b', noVocals: 'https://s3/nv?b' },
  expiresInSeconds: 900,
}

describe('useAudioUrls', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedAuth.fetchAuthSession.mockResolvedValue(session)
  })

  it('does not fetch when songId is null', async () => {
    renderHook(() => useAudioUrls(null, false), { wrapper: providersWrapper() })
    await new Promise((r) => setTimeout(r, 50))
    expect(mockedApi.getAudioUrls).not.toHaveBeenCalled()
  })

  it('fetches urls with a fresh ID token', async () => {
    mockedApi.getAudioUrls.mockResolvedValue(rawOnly)
    const { result } = renderHook(() => useAudioUrls('s1', false), { wrapper: providersWrapper() })
    await waitFor(() => expect(result.current.data).toEqual(rawOnly))
    expect(mockedApi.getAudioUrls).toHaveBeenCalledWith('tok', 's1')
    expect(mockedApi.getAudioUrls).toHaveBeenCalledTimes(1)
  })

  it('refetches exactly once when pipelineDone flips, keeping previous data meanwhile', async () => {
    mockedApi.getAudioUrls.mockResolvedValueOnce(rawOnly).mockResolvedValueOnce(allStems)
    const { result, rerender } = renderHook(({ done }) => useAudioUrls('s1', done), {
      wrapper: providersWrapper(),
      initialProps: { done: false },
    })
    await waitFor(() => expect(result.current.data).toEqual(rawOnly))
    rerender({ done: true })
    expect(result.current.data).toBeDefined() // keepPreviousData bridges the key change
    await waitFor(() => expect(result.current.data?.urls.vocals).toBe('https://s3/v?b'))
    rerender({ done: true })
    await new Promise((r) => setTimeout(r, 50))
    expect(mockedApi.getAudioUrls).toHaveBeenCalledTimes(2)
  })
})
