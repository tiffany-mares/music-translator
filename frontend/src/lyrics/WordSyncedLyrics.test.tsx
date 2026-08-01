import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as amplifyAuth from 'aws-amplify/auth'
import * as api from '../api/client'
import type { LyricsDoc } from '../api/types'
import { renderWithProviders } from '../test/renderWithProviders'
import WordSyncedLyrics from './WordSyncedLyrics'

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
      originalText: 'Salut mondo',
      translatedText: 'Hello world',
      startTime: 1,
      endTime: 2,
      words: [
        { text: 'Salut', start: 1, end: 1.4 },
        { text: 'mondo', start: 1.5, end: 2 },
      ],
    },
  ],
}

let frame: FrameRequestCallback | null = null

describe('WordSyncedLyrics', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedAuth.fetchAuthSession.mockResolvedValue(session)
    frame = null
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frame = cb
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
  })
  afterEach(() => vi.unstubAllGlobals())

  it('shows the loading placeholder until the doc arrives, then the panel', async () => {
    let resolve!: (d: LyricsDoc) => void
    mockedApi.getLyrics.mockReturnValue(new Promise((r) => (resolve = r)))
    renderWithProviders(
      <WordSyncedLyrics songId="s1" pipelineState="done" audioRef={{ current: null }} />,
    )
    expect(screen.getByText(/lyrics loading/i)).toBeInTheDocument()
    resolve(doc)
    await waitFor(() => expect(screen.getByTestId('lyrics-panel')).toBeInTheDocument())
    expect(screen.queryByText(/lyrics loading/i)).not.toBeInTheDocument()
  })

  it('running: shows the placeholder and never fetches lyrics', async () => {
    renderWithProviders(
      <WordSyncedLyrics songId="s1" pipelineState="running" audioRef={{ current: null }} />,
    )
    expect(screen.getByText(/lyrics loading/i)).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 30))
    expect(mockedApi.getLyrics).not.toHaveBeenCalled()
  })

  it('failed: renders nothing (JobStatusLine owns the alert) and never fetches', async () => {
    const { container } = renderWithProviders(
      <WordSyncedLyrics songId="s1" pipelineState="failed" audioRef={{ current: null }} />,
    )
    expect(container).toBeEmptyDOMElement()
    await new Promise((r) => setTimeout(r, 30))
    expect(mockedApi.getLyrics).not.toHaveBeenCalled()
  })

  it("done + fetch error: shows Couldn't load lyrics instead of an eternal placeholder", async () => {
    mockedApi.getLyrics.mockRejectedValue(new Error('500'))
    renderWithProviders(
      <WordSyncedLyrics songId="s1" pipelineState="done" audioRef={{ current: null }} />,
    )
    await waitFor(() => expect(screen.getByText(/couldn.t load lyrics/i)).toBeInTheDocument())
    expect(screen.queryByText(/lyrics loading/i)).not.toBeInTheDocument()
  })

  it('highlights the word containing audio.currentTime after a frame', async () => {
    mockedApi.getLyrics.mockResolvedValue(doc)
    const audio = { currentTime: 1.6 } as unknown as HTMLAudioElement
    renderWithProviders(
      <WordSyncedLyrics songId="s1" pipelineState="done" audioRef={{ current: audio }} />,
    )
    await waitFor(() => expect(screen.getByTestId('lyrics-panel')).toBeInTheDocument())
    act(() => frame?.(0))
    expect(screen.getByText('mondo')).toHaveClass('word-active')
    expect(screen.getByText('Salut')).not.toHaveClass('word-active')
  })
})

describe('WordSyncedLyrics vocab encounter (5.5)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedAuth.fetchAuthSession.mockResolvedValue(session)
    vi.stubGlobal('requestAnimationFrame', () => 1)
    vi.stubGlobal('cancelAnimationFrame', () => {})
    mockedApi.getLyrics.mockResolvedValue(doc)
    mockedApi.reviewVocab.mockResolvedValue({
      vocabId: 'mondo', nextReviewAt: '2026-08-02T00:00:00Z',
      intervalDays: 1, repetitions: 0, easeFactor: 2.5, created: true,
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  async function renderPanel() {
    renderWithProviders(
      <WordSyncedLyrics songId="s1" pipelineState="done" audioRef={{ current: null }} />,
    )
    await waitFor(() => expect(screen.getByTestId('lyrics-panel')).toBeInTheDocument())
  }

  it('clicking a word POSTs the quality-0 encounter built from the doc', async () => {
    await renderPanel()
    await userEvent.click(screen.getByText('mondo'))
    await waitFor(() =>
      expect(mockedApi.reviewVocab).toHaveBeenCalledWith('tok', {
        vocabId: 'mondo',
        quality: 0,
        term: 'mondo',
        definition: 'Hello world',
        songId: 's1',
      }),
    )
    await waitFor(() => expect(screen.getByText('mondo')).toHaveClass('word-saved'))
  })

  it('a second click on a saved word does not re-post', async () => {
    await renderPanel()
    await userEvent.click(screen.getByText('mondo'))
    await waitFor(() => expect(screen.getByText('mondo')).toHaveClass('word-saved'))
    await userEvent.click(screen.getByText('mondo'))
    await new Promise((r) => setTimeout(r, 30))
    expect(mockedApi.reviewVocab).toHaveBeenCalledTimes(1)
  })

  it('a failed save shows an alert and leaves the word unsaved for retry', async () => {
    mockedApi.reviewVocab.mockRejectedValue(new Error('500'))
    await renderPanel()
    await userEvent.click(screen.getByText('mondo'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t save/i)
    expect(screen.getByText('mondo')).not.toHaveClass('word-saved')
  })
})
