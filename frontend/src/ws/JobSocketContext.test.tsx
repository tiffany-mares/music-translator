import { StrictMode, type ReactNode } from 'react'
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
import { JobSocketProvider, useJobSocket } from './JobSocketContext'

vi.mock('aws-amplify/auth')
vi.mock('../api/client')
const mockedAuth = vi.mocked(amplifyAuth)
const mockedApi = vi.mocked(api)

type Session = Awaited<ReturnType<typeof amplifyAuth.fetchAuthSession>>
const session = {
  tokens: { idToken: { toString: () => 'tok', payload: { email: 'x@y.com' } } },
} as unknown as Session

function wrapperWith(client: QueryClient, strict = false) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const tree = (
      <QueryClientProvider client={client}>
        <AuthProvider>
          <JobSocketProvider>{children}</JobSocketProvider>
        </AuthProvider>
      </QueryClientProvider>
    )
    return strict ? <StrictMode>{tree}</StrictMode> : tree
  }
}

const alive = () => FakeWebSocket.instances.filter((w) => w.readyState !== FakeWebSocket.CLOSED)

describe('JobSocketProvider', () => {
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

  it('opens one socket with the env URL and token once signed in', async () => {
    const { unmount } = renderHook(() => useJobSocket(), { wrapper: wrapperWith(createTestClient()) })
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    expect(FakeWebSocket.last().url).toBe('wss://ws.example.com/prod?token=tok')
    unmount()
  })

  it('opens no socket when the session is signed out', async () => {
    mockedAuth.fetchAuthSession.mockRejectedValue(new Error('signed out'))
    renderHook(() => useJobSocket(), { wrapper: wrapperWith(createTestClient()) })
    await new Promise((r) => setTimeout(r, 50))
    expect(FakeWebSocket.instances).toHaveLength(0)
  })

  it('survives StrictMode double-mount with exactly one live socket', async () => {
    renderHook(() => useJobSocket(), { wrapper: wrapperWith(createTestClient(), true) })
    await waitFor(() => expect(alive()).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 50))
    expect(alive()).toHaveLength(1)
  })

  it('routes a frame into the shared job query with zero extra fetches', async () => {
    const queued: Job = { jobId: 's1.aaaa', songId: 's1', status: 'QUEUED' }
    mockedApi.getJob.mockResolvedValue(queued)
    const { result } = renderHook(() => useJobPolling('s1.aaaa'), {
      wrapper: wrapperWith(createTestClient()),
    })
    await waitFor(() => expect(result.current.data).toEqual(queued))
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    act(() => FakeWebSocket.last().open())
    const pushed: Job = { jobId: 's1.aaaa', songId: 's1', status: 'PROCESSING', stage: 'ChunkAudio' }
    act(() => FakeWebSocket.last().message(pushed))
    await waitFor(() => expect(result.current.data).toEqual(pushed))
    expect(mockedApi.getJob).toHaveBeenCalledTimes(1) // WS delivered it, not a poll
  })

  it('lands frames for not-yet-observed jobs in the cache (pre-mount pushes survive)', async () => {
    const client = createTestClient()
    renderHook(() => useJobSocket(), { wrapper: wrapperWith(client) })
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    act(() => FakeWebSocket.last().open())
    const frame: Job = { jobId: 's9.bbbb', songId: 's9', status: 'COMPLETE' }
    act(() => FakeWebSocket.last().message(frame))
    await waitFor(() => expect(client.getQueryData<Job>(['job', 's9.bbbb'])).toEqual(frame))
  })

  it('exposes healthy: false -> true on open -> false on close', async () => {
    const { result } = renderHook(() => useJobSocket(), { wrapper: wrapperWith(createTestClient()) })
    expect(result.current.healthy).toBe(false)
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    act(() => FakeWebSocket.last().open())
    await waitFor(() => expect(result.current.healthy).toBe(true))
    act(() => FakeWebSocket.last().serverClose())
    await waitFor(() => expect(result.current.healthy).toBe(false))
  })

  it('installs the kill hook while mounted; killing closes the socket; unmount removes it', async () => {
    const { result, unmount } = renderHook(() => useJobSocket(), {
      wrapper: wrapperWith(createTestClient()),
    })
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    act(() => FakeWebSocket.last().open())
    await waitFor(() => expect(result.current.healthy).toBe(true))
    expect(window.__cadenzaKillSocket).toBeTypeOf('function')
    act(() => window.__cadenzaKillSocket!())
    expect(FakeWebSocket.last().readyState).toBe(FakeWebSocket.CLOSED)
    await waitFor(() => expect(result.current.healthy).toBe(false))
    unmount()
    expect(window.__cadenzaKillSocket).toBeUndefined()
  })
})
