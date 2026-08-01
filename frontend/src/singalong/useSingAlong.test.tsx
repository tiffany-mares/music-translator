import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeWorker } from '../test/fakeWorker'
import { useSingAlong } from './useSingAlong'

// jsdom has no AudioContext; mic tests drive this fake's ScriptProcessor.
class FakeScriptProcessor {
  onaudioprocess:
    | ((ev: { inputBuffer: { getChannelData(i: number): Float32Array } }) => void)
    | null = null
  connect = vi.fn()
  disconnect = vi.fn()
}

class FakeAudioContext {
  static last: FakeAudioContext | null = null
  processor = new FakeScriptProcessor()
  destination = {}
  closed = false
  sourceDisconnect = vi.fn()

  constructor(_opts?: unknown) {
    FakeAudioContext.last = this
  }

  createMediaStreamSource() {
    return { connect: vi.fn(), disconnect: this.sourceDisconnect }
  }

  createScriptProcessor() {
    return this.processor
  }

  close() {
    this.closed = true
    return Promise.resolve()
  }
}

function stubMediaDevices(getUserMedia: (c: unknown) => Promise<unknown>) {
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
  })
}

function fakeStream() {
  const track = { stop: vi.fn() }
  return { stream: { getTracks: () => [track] }, track }
}

describe('useSingAlong', () => {
  beforeEach(() => {
    FakeWorker.reset()
    FakeAudioContext.last = null
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete (navigator as { mediaDevices?: unknown }).mediaDevices
  })

  const stubWorker = () => vi.stubGlobal('Worker', FakeWorker)

  it('mount spawns the crepe worker and posts load', () => {
    stubWorker()
    const { result } = renderHook(() => useSingAlong())
    expect(result.current.model).toEqual({ phase: 'loading' })
    expect(FakeWorker.instances).toHaveLength(1)
    expect(FakeWorker.last().url).toMatch(/crepeWorker/)
    expect(FakeWorker.last().posted).toEqual([{ type: 'load' }])
  })

  it('ready message carries source and ms into state', async () => {
    stubWorker()
    const { result } = renderHook(() => useSingAlong())
    act(() => FakeWorker.last().emit({ type: 'ready', source: 'indexeddb', ms: 412.5 }))
    await waitFor(() =>
      expect(result.current.model).toEqual({ phase: 'ready', source: 'indexeddb', ms: 412.5 }),
    )
  })

  it('error message surfaces the error state', async () => {
    stubWorker()
    const { result } = renderHook(() => useSingAlong())
    act(() => FakeWorker.last().emit({ type: 'error', message: 'boom' }))
    await waitFor(() => expect(result.current.model).toEqual({ phase: 'error', message: 'boom' }))
  })

  it('pitch messages update state, last one wins', async () => {
    stubWorker()
    const { result } = renderHook(() => useSingAlong())
    act(() => {
      FakeWorker.last().emit({ type: 'pitch', hz: 220, cents: 5000, confidence: 0.9 })
      FakeWorker.last().emit({ type: 'pitch', hz: 440, cents: 6551, confidence: 0.8 })
    })
    await waitFor(() =>
      expect(result.current.pitch).toEqual({ hz: 440, cents: 6551, confidence: 0.8 }),
    )
  })

  it('reports unsupported when there is no Worker global (jsdom default)', () => {
    const { result } = renderHook(() => useSingAlong())
    expect(result.current.model).toEqual({ phase: 'unsupported' })
    expect(FakeWorker.instances).toHaveLength(0)
  })

  it('unmount terminates the worker', () => {
    stubWorker()
    const { unmount } = renderHook(() => useSingAlong())
    unmount()
    expect(FakeWorker.last().terminated).toBe(true)
  })

  it('startMic captures 1024-sample frames and posts them to the worker', async () => {
    stubWorker()
    vi.stubGlobal('AudioContext', FakeAudioContext)
    const { stream } = fakeStream()
    stubMediaDevices(() => Promise.resolve(stream))
    const { result } = renderHook(() => useSingAlong())
    await act(() => result.current.startMic())
    expect(result.current.micOn).toBe(true)
    const ctx = FakeAudioContext.last!
    act(() =>
      ctx.processor.onaudioprocess!({
        inputBuffer: { getChannelData: () => new Float32Array(1024).fill(0.5) },
      }),
    )
    const frames = FakeWorker.last().posted.filter(
      (m) => (m as { type: string }).type === 'frame',
    )
    expect(frames).toHaveLength(1)
    expect((frames[0] as { samples: Float32Array }).samples).toHaveLength(1024)
  })

  it('mic denial (NotAllowedError) sets micError denied', async () => {
    stubWorker()
    stubMediaDevices(() => Promise.reject(new DOMException('denied', 'NotAllowedError')))
    const { result } = renderHook(() => useSingAlong())
    await act(() => result.current.startMic())
    expect(result.current.micError).toBe('denied')
    expect(result.current.micOn).toBe(false)
  })

  it('missing mediaDevices sets micError unavailable', async () => {
    stubWorker()
    const { result } = renderHook(() => useSingAlong())
    await act(() => result.current.startMic())
    expect(result.current.micError).toBe('unavailable')
  })

  it('stopMic stops tracks, closes the context, and clears pitch', async () => {
    stubWorker()
    vi.stubGlobal('AudioContext', FakeAudioContext)
    const { stream, track } = fakeStream()
    stubMediaDevices(() => Promise.resolve(stream))
    const { result } = renderHook(() => useSingAlong())
    await act(() => result.current.startMic())
    act(() => FakeWorker.last().emit({ type: 'pitch', hz: 440, cents: 6551, confidence: 0.9 }))
    act(() => result.current.stopMic())
    expect(track.stop).toHaveBeenCalled()
    expect(FakeAudioContext.last!.closed).toBe(true)
    expect(result.current.micOn).toBe(false)
    expect(result.current.pitch).toBeNull()
  })
})
