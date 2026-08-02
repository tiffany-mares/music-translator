import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Typewriter from './Typewriter'

const PHRASES = ['separates the vocals.', 'times every word.']

// React commits effect-scheduled timer chains only when act() flushes, so at
// most ONE state transition lands per act, regardless of how far the virtual
// clock advances. Count transitions (steps), not milliseconds.
async function steps(n: number, stepMs = 60) {
  for (let i = 0; i < n; i++) {
    await act(() => vi.advanceTimersByTimeAsync(stepMs))
  }
}

describe('Typewriter', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('types the first phrase character by character', async () => {
    render(<Typewriter phrases={PHRASES} />)
    expect(screen.getByTestId('typewriter').textContent).toBe('')
    await steps(PHRASES[0].length + 3)
    expect(screen.getByTestId('typewriter').textContent).toBe(PHRASES[0])
  })

  it('deletes and reaches the second phrase after the hold', async () => {
    render(<Typewriter phrases={PHRASES} />)
    // type 21 + hold (2200ms / 60ms steps) + delete 21 + retype 17 + slack
    await steps(21 + 37 + 21 + 17 + 10)
    expect(screen.getByTestId('typewriter').textContent).toBe(PHRASES[1])
  })

  it('renders the full first phrase statically under reduced motion', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('prefers-reduced-motion'),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    render(<Typewriter phrases={PHRASES} />)
    expect(screen.getByTestId('typewriter').textContent).toBe(PHRASES[0])
    vi.unstubAllGlobals()
  })
})
