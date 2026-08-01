import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeWorker } from '../test/fakeWorker'
import SingAlongPanel from './SingAlongPanel'

describe('SingAlongPanel', () => {
  beforeEach(() => {
    FakeWorker.reset()
    vi.stubGlobal('Worker', FakeWorker)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete (navigator as { mediaDevices?: unknown }).mediaDevices
  })

  const ready = (source: 'network' | 'indexeddb', ms = 3200) =>
    FakeWorker.last().emit({ type: 'ready', source, ms })

  it('shows the loading line and posts load on mount', () => {
    render(<SingAlongPanel />)
    expect(screen.getByText(/loading pitch model/i)).toBeInTheDocument()
    expect(FakeWorker.last().posted).toEqual([{ type: 'load' }])
  })

  it('network-loaded model reports "downloaded" with elapsed seconds', async () => {
    render(<SingAlongPanel />)
    ready('network', 5400)
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Model ready in 5.4s'),
    )
    expect(screen.getByRole('status')).toHaveTextContent('downloaded')
  })

  it('IndexedDB-loaded model reports the cache source (the 6.4 gate evidence)', async () => {
    render(<SingAlongPanel />)
    ready('indexeddb', 700)
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Model ready in 0.7s'),
    )
    expect(screen.getByRole('status')).toHaveTextContent('loaded from cache (IndexedDB)')
  })

  it('confident pitch renders the note, cents and Hz', async () => {
    render(<SingAlongPanel />)
    ready('indexeddb')
    // 445 Hz -> A4, +20 cents sharp
    FakeWorker.last().emit({ type: 'pitch', hz: 445, cents: 6570.9, confidence: 0.92 })
    await waitFor(() => expect(screen.getByTestId('singalong-note')).toBeInTheDocument())
    expect(screen.getByTestId('singalong-note')).toHaveTextContent('A4')
    expect(screen.getByTestId('singalong-note')).toHaveTextContent('+20 cents')
    expect(screen.getByTestId('singalong-note')).toHaveTextContent('445.0 Hz')
  })

  it('low-confidence pitch shows Listening instead of a note', async () => {
    render(<SingAlongPanel />)
    ready('indexeddb')
    FakeWorker.last().emit({ type: 'pitch', hz: 123, cents: 4340, confidence: 0.2 })
    await waitFor(() => expect(screen.getByText(/listening/i)).toBeInTheDocument())
    expect(screen.queryByTestId('singalong-note')).not.toBeInTheDocument()
  })

  it('mic denial surfaces an alert', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: () => Promise.reject(new DOMException('denied', 'NotAllowedError')),
      },
      configurable: true,
    })
    render(<SingAlongPanel />)
    ready('indexeddb')
    await userEvent.click(await screen.findByRole('button', { name: /start singing/i }))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/microphone access was denied/i),
    )
  })

  it('worker error surfaces an alert with the message', async () => {
    render(<SingAlongPanel />)
    FakeWorker.last().emit({ type: 'error', message: 'model fetch failed' })
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/model fetch failed/i),
    )
  })

  it('missing Worker support shows the unsupported alert', () => {
    vi.unstubAllGlobals() // back to jsdom reality: no Worker
    render(<SingAlongPanel />)
    expect(screen.getByRole('alert')).toHaveTextContent(/web worker/i)
  })
})
