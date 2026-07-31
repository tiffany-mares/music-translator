import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as amplifyAuth from 'aws-amplify/auth'
import { AuthProvider, useAuth } from './AuthContext'

vi.mock('aws-amplify/auth')
const mocked = vi.mocked(amplifyAuth)

type Session = Awaited<ReturnType<typeof amplifyAuth.fetchAuthSession>>
const sessionWithToken = {
  tokens: { idToken: { toString: () => 'the-raw-jwt', payload: { email: 'x@y.com' } } },
} as unknown as Session

describe('getIdToken', () => {
  beforeEach(() => vi.resetAllMocks())

  it('resolves the raw ID token string', async () => {
    mocked.fetchAuthSession.mockResolvedValue(sessionWithToken)
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await waitFor(() => expect(result.current.status).toBe('signedIn'))
    await expect(result.current.getIdToken()).resolves.toBe('the-raw-jwt')
  })

  it('throws when no session tokens exist', async () => {
    mocked.fetchAuthSession.mockResolvedValue({} as Session)
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await waitFor(() => expect(result.current.status).toBe('signedOut'))
    await expect(result.current.getIdToken()).rejects.toThrow('session expired')
  })
})
