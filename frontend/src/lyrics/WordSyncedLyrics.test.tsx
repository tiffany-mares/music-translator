import { act, screen, waitFor } from '@testing-library/react'
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

  it('renders nothing until the doc arrives (no placeholder - 4.5 scope)', async () => {
    let resolve!: (d: LyricsDoc) => void
    mockedApi.getLyrics.mockReturnValue(new Promise((r) => (resolve = r)))
    renderWithProviders(
      <WordSyncedLyrics songId="s1" pipelineDone audioRef={{ current: null }} />,
    )
    expect(screen.queryByTestId('lyrics-panel')).not.toBeInTheDocument()
    resolve(doc)
    await waitFor(() => expect(screen.getByTestId('lyrics-panel')).toBeInTheDocument())
  })

  it('highlights the word containing audio.currentTime after a frame', async () => {
    mockedApi.getLyrics.mockResolvedValue(doc)
    const audio = { currentTime: 1.6 } as unknown as HTMLAudioElement
    renderWithProviders(<WordSyncedLyrics songId="s1" pipelineDone audioRef={{ current: audio }} />)
    await waitFor(() => expect(screen.getByTestId('lyrics-panel')).toBeInTheDocument())
    act(() => frame?.(0))
    expect(screen.getByText('mondo')).toHaveClass('word-active')
    expect(screen.getByText('Salut')).not.toHaveClass('word-active')
  })
})
