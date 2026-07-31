import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as amplifyAuth from 'aws-amplify/auth'
import * as api from '../api/client'
import type { AudioUrls, Job } from '../api/types'
import { renderWithProviders } from '../test/renderWithProviders'
import Player from './Player'

vi.mock('aws-amplify/auth')
vi.mock('../api/client')
const mockedAuth = vi.mocked(amplifyAuth)
const mockedApi = vi.mocked(api)

type Session = Awaited<ReturnType<typeof amplifyAuth.fetchAuthSession>>
const session = {
  tokens: { idToken: { toString: () => 'tok', payload: { email: 'x@y.com' } } },
} as unknown as Session

const rawOnly: AudioUrls = { urls: { raw: 'https://s3/raw?a' }, expiresInSeconds: 900 }
const allStems: AudioUrls = {
  urls: { raw: 'https://s3/raw?b', vocals: 'https://s3/v?b', noVocals: 'https://s3/nv?b' },
  expiresInSeconds: 900,
}

const lyricsDoc = {
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

describe('Player', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedAuth.fetchAuthSession.mockResolvedValue(session)
    // Linked-path tests mount lyrics immediately; keep the query quiet by default.
    mockedApi.getLyrics.mockResolvedValue({
      songId: 's0',
      sourceLanguage: 'ro',
      targetLanguage: 'en',
      lines: [],
    })
  })

  it('shows preparing state, then renders audio with the raw url', async () => {
    mockedApi.getJob.mockResolvedValue({ jobId: 's1.aaaa', songId: 's1', status: 'QUEUED' } as Job)
    mockedApi.getAudioUrls.mockResolvedValue(rawOnly)
    renderWithProviders(<Player songId="s1" jobId="s1.aaaa" />)
    expect(screen.getByText(/preparing audio/i)).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByTestId('player-audio')).toHaveAttribute('src', 'https://s3/raw?a'),
    )
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
  })

  it('renders a stem button per available url and never polls on the linked path', async () => {
    mockedApi.getAudioUrls.mockResolvedValue(allStems)
    renderWithProviders(<Player songId="s2" jobId={null} />)
    await waitFor(() => expect(screen.getByRole('group', { name: /audio track/i })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Original' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Vocals' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Instrumental' })).toBeInTheDocument()
    expect(mockedApi.getJob).not.toHaveBeenCalled()
  })

  it('switching stems swaps the audio src', async () => {
    mockedApi.getAudioUrls.mockResolvedValue(allStems)
    renderWithProviders(<Player songId="s2" jobId={null} />)
    await waitFor(() => expect(screen.getByTestId('player-audio')).toHaveAttribute('src', 'https://s3/raw?b'))
    await userEvent.click(screen.getByRole('button', { name: 'Instrumental' }))
    expect(screen.getByTestId('player-audio')).toHaveAttribute('src', 'https://s3/nv?b')
    expect(screen.getByRole('button', { name: 'Instrumental' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('does not fetch lyrics while the pipeline is still running', async () => {
    mockedApi.getJob.mockResolvedValue({ jobId: 's1.aaaa', songId: 's1', status: 'PROCESSING' } as Job)
    mockedApi.getAudioUrls.mockResolvedValue(rawOnly)
    renderWithProviders(<Player songId="s1" jobId="s1.aaaa" />)
    await waitFor(() => expect(screen.getByTestId('player-audio')).toBeInTheDocument())
    await new Promise((r) => setTimeout(r, 50))
    expect(mockedApi.getLyrics).not.toHaveBeenCalled()
  })

  it('hydrates lyrics once the job is COMPLETE', async () => {
    mockedApi.getJob.mockResolvedValue({ jobId: 's1.aaaa', songId: 's1', status: 'COMPLETE' } as Job)
    mockedApi.getAudioUrls.mockResolvedValue(allStems)
    mockedApi.getLyrics.mockResolvedValue(lyricsDoc)
    renderWithProviders(<Player songId="s1" jobId="s1.aaaa" />)
    await waitFor(() => expect(screen.getByText('Salut')).toBeInTheDocument())
    expect(screen.getByText('Hello world')).toBeInTheDocument()
    expect(mockedApi.getLyrics).toHaveBeenCalledWith('tok', 's1')
  })

  it('fetches lyrics for lyricsSongId when it differs (linked path)', async () => {
    mockedApi.getAudioUrls.mockResolvedValue(allStems)
    mockedApi.getLyrics.mockResolvedValue({ ...lyricsDoc, songId: 'orig0' })
    renderWithProviders(<Player songId="s9" jobId={null} lyricsSongId="orig0" />)
    await waitFor(() => expect(mockedApi.getLyrics).toHaveBeenCalledWith('tok', 'orig0'))
    expect(mockedApi.getAudioUrls).toHaveBeenCalledWith('tok', 's9') // audio stays on the NEW songId
  })

  it('running pipeline: shows "Lyrics loading…" under the player', async () => {
    mockedApi.getJob.mockResolvedValue({ jobId: 's1.aaaa', songId: 's1', status: 'PROCESSING' } as Job)
    mockedApi.getAudioUrls.mockResolvedValue(rawOnly)
    renderWithProviders(<Player songId="s1" jobId="s1.aaaa" />)
    await waitFor(() => expect(screen.getByText(/lyrics loading/i)).toBeInTheDocument())
  })

  it('FAILED pipeline: audio stays mounted, no "Lyrics loading…", no lyrics fetch', async () => {
    mockedApi.getJob.mockResolvedValue({
      jobId: 's1.aaaa', songId: 's1', status: 'FAILED', error: 'ChunkAudio: decode error',
    } as Job)
    mockedApi.getAudioUrls.mockResolvedValue(rawOnly)
    renderWithProviders(<Player songId="s1" jobId="s1.aaaa" />)
    await waitFor(() => expect(screen.getByTestId('player-audio')).toBeInTheDocument())
    expect(screen.queryByText(/lyrics loading/i)).not.toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 30))
    expect(mockedApi.getLyrics).not.toHaveBeenCalled()
  })

  it('audio-urls failure replaces "Preparing audio…" with an error + Retry', async () => {
    mockedApi.getAudioUrls.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(rawOnly)
    renderWithProviders(<Player songId="s1" jobId={null} />)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/couldn.t load audio/i))
    expect(screen.queryByText(/preparing audio/i)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^retry$/i }))
    await waitFor(() =>
      expect(screen.getByTestId('player-audio')).toHaveAttribute('src', 'https://s3/raw?a'),
    )
  })

  it('media element error surfaces a Reload track affordance', async () => {
    mockedApi.getAudioUrls.mockResolvedValue(rawOnly)
    renderWithProviders(<Player songId="s1" jobId={null} />)
    await waitFor(() => expect(screen.getByTestId('player-audio')).toBeInTheDocument())
    fireEvent.error(screen.getByTestId('player-audio'))
    expect(screen.getByRole('alert')).toHaveTextContent(/failed to load|expired/i)
    expect(screen.getByRole('button', { name: /reload track/i })).toBeInTheDocument()
  })

  it('Reload track refetches urls and adopts the fresh src', async () => {
    const fresh: AudioUrls = { urls: { raw: 'https://s3/raw?fresh' }, expiresInSeconds: 900 }
    mockedApi.getAudioUrls.mockResolvedValueOnce(rawOnly).mockResolvedValueOnce(fresh)
    renderWithProviders(<Player songId="s1" jobId={null} />)
    await waitFor(() =>
      expect(screen.getByTestId('player-audio')).toHaveAttribute('src', 'https://s3/raw?a'),
    )
    fireEvent.error(screen.getByTestId('player-audio'))
    await userEvent.click(screen.getByRole('button', { name: /reload track/i }))
    await waitFor(() =>
      expect(screen.getByTestId('player-audio')).toHaveAttribute('src', 'https://s3/raw?fresh'),
    )
    expect(screen.queryByRole('button', { name: /reload track/i })).not.toBeInTheDocument()
    expect(mockedApi.getAudioUrls).toHaveBeenCalledTimes(2)
  })

  it('keeps the playing src when a refetch re-signs the urls', async () => {
    const rawFirst: AudioUrls = { urls: { raw: 'https://s3/raw?first' }, expiresInSeconds: 900 }
    const resigned: AudioUrls = {
      urls: { raw: 'https://s3/raw?resigned', vocals: 'https://s3/v?x', noVocals: 'https://s3/nv?x' },
      expiresInSeconds: 900,
    }
    mockedApi.getAudioUrls.mockResolvedValueOnce(rawFirst).mockResolvedValueOnce(resigned)
    // Job resolves COMPLETE on its first poll, flipping pipelineDone immediately
    // so both fetches happen without waiting on poll intervals.
    mockedApi.getJob.mockResolvedValue({ jobId: 's1.aaaa', songId: 's1', status: 'COMPLETE' } as Job)
    renderWithProviders(<Player songId="s1" jobId="s1.aaaa" />)
    await waitFor(() => expect(screen.getByTestId('player-audio')).toHaveAttribute('src', 'https://s3/raw?first'))
    // The re-signed fetch landed (stem buttons appear) but the adopted src must not change.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Instrumental' })).toBeInTheDocument())
    expect(screen.getByTestId('player-audio')).toHaveAttribute('src', 'https://s3/raw?first')
  })
})
