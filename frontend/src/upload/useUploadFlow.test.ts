import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as amplifyAuth from 'aws-amplify/auth'
import * as api from '../api/client'
import { ApiError } from '../api/types'
import { AuthProvider } from '../auth/AuthContext'
import { useUploadFlow } from './useUploadFlow'

vi.mock('aws-amplify/auth')
vi.mock('../api/client')
const mockedAuth = vi.mocked(amplifyAuth)
const mockedApi = vi.mocked(api)

const makeFile = () =>
  new File([new Uint8Array(60_000)], 'song.mp3', { type: 'audio/mpeg' })

describe('quota 429 surfacing (Phase 7 follow-up)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    // Anonymous session: getOptionalIdToken resolves null.
    mockedAuth.fetchAuthSession.mockResolvedValue({} as never)
  })

  it('surfaces the server error body on a 429 from createSong', async () => {
    mockedApi.createSong.mockRejectedValue(
      new ApiError(429, { error: 'Daily upload limit reached — sign in or try again tomorrow.' }),
    )
    const { result } = renderHook(() => useUploadFlow(), { wrapper: AuthProvider })
    await act(() => result.current.start(makeFile(), undefined))
    expect(result.current.state).toEqual({
      step: 'error',
      message: 'Daily upload limit reached — sign in or try again tomorrow.',
    })
  })

  it('falls back to the generic message when the body has no error text', async () => {
    mockedApi.createSong.mockRejectedValue(new ApiError(500, null))
    const { result } = renderHook(() => useUploadFlow(), { wrapper: AuthProvider })
    await act(() => result.current.start(makeFile(), undefined))
    expect(result.current.state).toEqual({ step: 'error', message: 'API error 500' })
  })
})
