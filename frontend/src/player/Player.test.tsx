import { screen, waitFor } from '@testing-library/react'
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

describe('Player', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedAuth.fetchAuthSession.mockResolvedValue(session)
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
