import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as amplifyAuth from 'aws-amplify/auth'
import * as api from '../api/client'
import type { LyricsDoc } from '../api/types'
import { providersWrapper } from '../test/renderWithProviders'
import { useLyrics } from './useLyrics'

vi.mock('aws-amplify/auth')
vi.mock('../api/client')
const mockedAuth = vi.mocked(amplifyAuth)
const mockedApi = vi.mocked(api)

type Session = Awaited<ReturnType<typeof amplifyAuth.fetchAuthSession>>
const session = {
  tokens: { idToken: { toString: () => 'tok', payload: { email: 'x@y.com' } } },
} as unknown as Session

const doc: LyricsDoc = {
  songId: 's1',
  sourceLanguage: 'ro',
  targetLanguage: 'en',
  lines: [
    {
      lineNumber: 1,
      originalText: 'Salut',
      translatedText: 'Hello',
      startTime: 1,
      endTime: 2,
      words: [{ text: 'Salut', start: 1, end: 2 }],
    },
  ],
}

describe('useLyrics', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedAuth.fetchAuthSession.mockResolvedValue(session)
  })

  it('does not fetch when songId is null', async () => {
    renderHook(() => useLyrics(null, true), { wrapper: providersWrapper() })
    await new Promise((r) => setTimeout(r, 50))
    expect(mockedApi.getLyrics).not.toHaveBeenCalled()
  })

  it('never fetches while the pipeline is running (the guaranteed-404 window)', async () => {
    renderHook(() => useLyrics('s1', false), { wrapper: providersWrapper() })
    await new Promise((r) => setTimeout(r, 50))
    expect(mockedApi.getLyrics).not.toHaveBeenCalled()
  })

  it('fetches once with a fresh ID token once the pipeline is done', async () => {
    mockedApi.getLyrics.mockResolvedValue(doc)
    const { result } = renderHook(() => useLyrics('s1', true), { wrapper: providersWrapper() })
    await waitFor(() => expect(result.current.data).toEqual(doc))
    expect(mockedApi.getLyrics).toHaveBeenCalledWith('tok', 's1')
    expect(mockedApi.getLyrics).toHaveBeenCalledTimes(1)
  })

  it('hydrates without a reload: flipping pipelineDone triggers exactly one fetch', async () => {
    mockedApi.getLyrics.mockResolvedValue(doc)
    const { result, rerender } = renderHook(({ done }) => useLyrics('s1', done), {
      wrapper: providersWrapper(),
      initialProps: { done: false },
    })
    await new Promise((r) => setTimeout(r, 50))
    expect(mockedApi.getLyrics).not.toHaveBeenCalled()
    rerender({ done: true })
    await waitFor(() => expect(result.current.data).toEqual(doc))
    rerender({ done: true })
    await new Promise((r) => setTimeout(r, 50))
    expect(mockedApi.getLyrics).toHaveBeenCalledTimes(1)
  })
})
