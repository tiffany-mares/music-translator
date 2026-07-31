import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWordSync } from './useWordSync'
import type { FlatWord } from './wordSync'

const FLAT: FlatWord[] = [
  { lineIndex: 0, wordIndex: 0, start: 1, end: 2 },
  { lineIndex: 0, wordIndex: 1, start: 3, end: 4 },
]

let frame: FrameRequestCallback | null = null

beforeEach(() => {
  frame = null
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frame = cb
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
})
afterEach(() => vi.unstubAllGlobals())

const tick = () => act(() => frame?.(0))

describe('useWordSync', () => {
  it('starts at -1 and stays -1 while playback is before the first word', () => {
    const audio = { currentTime: 0 } as unknown as HTMLAudioElement
    const { result } = renderHook(() => useWordSync({ current: audio }, FLAT))
    expect(result.current).toBe(-1)
    tick()
    expect(result.current).toBe(-1)
  })

  it('tracks currentTime into words and re-renders only on index changes', () => {
    const audio = { currentTime: 0 } as unknown as HTMLAudioElement
    // Stable ref object, matching production's useRef (an inline literal would
    // re-run the hook's effect every render and skew the render count).
    const ref = { current: audio }
    let renders = 0
    const { result } = renderHook(() => {
      renders++
      return useWordSync(ref, FLAT)
    })
    audio.currentTime = 1.5
    tick()
    expect(result.current).toBe(0)
    const after = renders
    audio.currentTime = 1.6 // still inside word 0: no state change, no render
    tick()
    tick()
    expect(renders).toBe(after)
    audio.currentTime = 3.2
    tick()
    expect(result.current).toBe(1)
  })
})
