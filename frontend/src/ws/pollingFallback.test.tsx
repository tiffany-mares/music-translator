import { type ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as amplifyAuth from 'aws-amplify/auth'
import * as api from '../api/client'
import type { Job } from '../api/types'
import { AuthProvider } from '../auth/AuthContext'
import { createTestClient } from '../test/renderWithProviders'
import { FakeWebSocket } from '../test/fakeWebSocket'
import { useJobPolling } from '../upload/useJobPolling'
import { JobSocketProvider } from './JobSocketContext'

vi.mock('aws-amplify/auth')
vi.mock('../api/client')
const mockedAuth = vi.mocked(amplifyAuth)
const mockedApi = vi.mocked(api)

type Session = Awaited<ReturnType<typeof amplifyAuth.fetchAuthSession>>
const session = {
  tokens: { idToken: { toString: () => 'tok', payload: { email: 'x@y.com' } } },
} as unknown as Session

function wrapperWith(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <AuthProvider>
          <JobSocketProvider>{children}</JobSocketProvider>
        </AuthProvider>
      </QueryClientProvider>
    )
  }
}

// The 6.3 done-when, end to end at the hook level: with the socket healthy the
// query idles on the 60s safety net; a deliberate kill mid-session must flip
// the interval back to the 4.2 backoff and actually re-poll. (Written during
// the live gate when Chrome's background-tab freezing mimicked exactly this
// failure — the unit proof separated app behavior from browser throttling.)
describe('polling fallback after a deliberate socket kill', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    FakeWebSocket.reset()
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.stubEnv('VITE_WS_URL', 'wss://ws.example.com/prod')
    mockedAuth.fetchAuthSession.mockResolvedValue(session)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('kill mid-session -> GET /jobs resumes within the backoff window', async () => {
    const processing: Job = { jobId: 's1.aaaa', songId: 's1', status: 'PROCESSING' }
    mockedApi.getJob.mockResolvedValue(processing)
    const { result } = renderHook(() => useJobPolling('s1.aaaa'), {
      wrapper: wrapperWith(createTestClient()),
    })
    await waitFor(() => expect(result.current.data).toEqual(processing))
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    act(() => FakeWebSocket.last().open())
    expect(mockedApi.getJob).toHaveBeenCalledTimes(1) // healthy: only the mount fetch
    // deliberate kill (the done-when)
    act(() => window.__cadenzaKillSocket!())
    // dataUpdateCount is 1 -> backoff 2000ms; polling must fire within ~3s
    await waitFor(() => expect(mockedApi.getJob.mock.calls.length).toBeGreaterThanOrEqual(2), {
      timeout: 4000,
    })
  }, 10000)
})
