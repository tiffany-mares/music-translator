import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeWebSocket } from '../test/fakeWebSocket'
import { JobSocket, KEEPALIVE_MS, type JobSocketOptions } from './jobSocket'

const URL = 'wss://ws.example.com/prod'

function makeSocket(overrides: Partial<JobSocketOptions> = {}) {
  const onFrame = vi.fn()
  const onHealthy = vi.fn()
  const getToken = vi.fn<() => Promise<string>>().mockResolvedValue('tok')
  const socket = new JobSocket({ url: URL, getToken, onFrame, onHealthy, ...overrides })
  return { socket, onFrame, onHealthy, getToken }
}

// Flushes the microtask queue (the awaited getToken) under fake timers.
const flush = () => vi.advanceTimersByTimeAsync(0)

describe('JobSocket', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeWebSocket.reset()
    vi.stubGlobal('WebSocket', FakeWebSocket)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('connects with a fresh token as the token query param', async () => {
    makeSocket().socket.start()
    await flush()
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(FakeWebSocket.last().url).toBe(`${URL}?token=tok`)
  })

  it('reports healthy on open and unhealthy on close', async () => {
    const { socket, onHealthy } = makeSocket()
    socket.start()
    await flush()
    FakeWebSocket.last().open()
    expect(onHealthy).toHaveBeenLastCalledWith(true)
    FakeWebSocket.last().serverClose()
    expect(onHealthy).toHaveBeenLastCalledWith(false)
  })

  it('forwards frames that carry a jobId', async () => {
    const { socket, onFrame } = makeSocket()
    socket.start()
    await flush()
    FakeWebSocket.last().open()
    const job = { jobId: 's1.aaaa', songId: 's1', status: 'PROCESSING', stage: 'ChunkAudio' }
    FakeWebSocket.last().message(job)
    expect(onFrame).toHaveBeenCalledWith(job)
  })

  it('ignores frames without a jobId and non-JSON frames', async () => {
    const { socket, onFrame } = makeSocket()
    socket.start()
    await flush()
    FakeWebSocket.last().open()
    // the API GW error frame every keepalive draws back (no $default route)
    FakeWebSocket.last().message({ message: 'Forbidden', connectionId: 'abc', requestId: 'r' })
    FakeWebSocket.last().message('not json at all')
    FakeWebSocket.last().message({ jobId: 42 }) // non-string jobId
    expect(onFrame).not.toHaveBeenCalled()
  })

  it('sends an app-level keepalive every 240s while open', async () => {
    const { socket } = makeSocket()
    socket.start()
    await flush()
    FakeWebSocket.last().open()
    await vi.advanceTimersByTimeAsync(KEEPALIVE_MS - 1)
    expect(FakeWebSocket.last().sent).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(FakeWebSocket.last().sent).toEqual(['{"action":"keepalive"}'])
    await vi.advanceTimersByTimeAsync(KEEPALIVE_MS)
    expect(FakeWebSocket.last().sent).toHaveLength(2)
  })

  it('reconnects 1s after an unexpected close, with a fresh token, and stops the keepalive', async () => {
    const getToken = vi.fn<() => Promise<string>>()
      .mockResolvedValueOnce('tok1')
      .mockResolvedValueOnce('tok2')
    const { socket } = makeSocket({ getToken })
    socket.start()
    await flush()
    const first = FakeWebSocket.last()
    first.open()
    first.serverClose()
    await vi.advanceTimersByTimeAsync(999)
    expect(FakeWebSocket.instances).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(FakeWebSocket.instances).toHaveLength(2)
    expect(FakeWebSocket.last().url).toBe(`${URL}?token=tok2`)
    await vi.advanceTimersByTimeAsync(KEEPALIVE_MS)
    expect(first.sent).toHaveLength(0) // dead socket's keepalive was cleared
  })

  it('doubles the reconnect delay per consecutive failure and caps at 30s', async () => {
    const { socket } = makeSocket()
    socket.start()
    await flush()
    // 6 failed attempts walk the ladder 1,2,4,8,16,30 (cap)
    for (let i = 0; i < 6; i++) {
      FakeWebSocket.last().serverClose() // never opened -> attempt keeps growing
      await vi.advanceTimersByTimeAsync(32_000)
    }
    const count = FakeWebSocket.instances.length
    FakeWebSocket.last().serverClose()
    await vi.advanceTimersByTimeAsync(29_999)
    expect(FakeWebSocket.instances).toHaveLength(count)
    await vi.advanceTimersByTimeAsync(1)
    expect(FakeWebSocket.instances).toHaveLength(count + 1)
  })

  it('resets the backoff after a successful open', async () => {
    const { socket } = makeSocket()
    socket.start()
    await flush()
    FakeWebSocket.last().serverClose() // failure #1
    await vi.advanceTimersByTimeAsync(1000)
    FakeWebSocket.last().serverClose() // failure #2 -> next delay would be 4s...
    await vi.advanceTimersByTimeAsync(2000)
    FakeWebSocket.last().open() // ...but success resets the ladder
    FakeWebSocket.last().serverClose()
    const count = FakeWebSocket.instances.length
    await vi.advanceTimersByTimeAsync(1000) // back to the 1s base
    expect(FakeWebSocket.instances).toHaveLength(count + 1)
  })

  it('stop() closes the socket, reports unhealthy, and never reconnects', async () => {
    const { socket, onHealthy } = makeSocket()
    socket.start()
    await flush()
    FakeWebSocket.last().open()
    socket.stop()
    expect(FakeWebSocket.last().readyState).toBe(FakeWebSocket.CLOSED)
    expect(onHealthy).toHaveBeenLastCalledWith(false)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('stop() during the token fetch aborts the connect (StrictMode race)', async () => {
    let resolveToken!: (t: string) => void
    const getToken = vi.fn(() => new Promise<string>((r) => (resolveToken = r)))
    const { socket } = makeSocket({ getToken })
    socket.start()
    socket.stop()
    resolveToken('tok')
    await flush()
    expect(FakeWebSocket.instances).toHaveLength(0)
  })

  it('stays silently unhealthy when no WebSocket global exists (jsdom)', async () => {
    vi.unstubAllGlobals()
    const { socket, onHealthy } = makeSocket()
    expect(() => socket.start()).not.toThrow()
    await vi.advanceTimersByTimeAsync(3_600_000)
    expect(onHealthy).not.toHaveBeenCalled()
    expect(FakeWebSocket.instances).toHaveLength(0) // never constructed
  })

  it('retries with backoff when the token fetch rejects', async () => {
    const getToken = vi.fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('session expired'))
      .mockResolvedValueOnce('tok')
    const { socket } = makeSocket({ getToken })
    socket.start()
    await flush()
    expect(FakeWebSocket.instances).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(FakeWebSocket.instances).toHaveLength(1)
  })
})
