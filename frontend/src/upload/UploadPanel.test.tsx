import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as amplifyAuth from 'aws-amplify/auth'
import * as api from '../api/client'
import type { Job } from '../api/types'
import { renderWithProviders } from '../test/renderWithProviders'
import UploadPanel from './UploadPanel'

vi.mock('aws-amplify/auth')
vi.mock('../api/client')
const mockedAuth = vi.mocked(amplifyAuth)
const mockedApi = vi.mocked(api)

type Session = Awaited<ReturnType<typeof amplifyAuth.fetchAuthSession>>
const session = {
  tokens: { idToken: { toString: () => 'tok', payload: { email: 'x@y.com' } } },
} as unknown as Session

function audioFile(bytes = 60 * 1024, name = 'song.mp3') {
  return new File([new Uint8Array(bytes)], name, { type: 'audio/mpeg' })
}

async function pickAndSubmit(file: File, title?: string) {
  if (title) await userEvent.type(screen.getByLabelText(/title/i), title)
  await userEvent.upload(screen.getByLabelText(/audio file/i), file)
  // jsdom marks a `required` file input invalid even with files attached, so a
  // click on the submit button is blocked by constraint validation there (real
  // browsers validate correctly). Submit the form directly instead.
  fireEvent.submit(screen.getByRole('form', { name: /upload a song/i }))
}

describe('UploadPanel', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedAuth.fetchAuthSession.mockResolvedValue(session)
  })

  it('runs the full started path and shows job status', async () => {
    mockedApi.createSong.mockResolvedValue({ songId: 's1', uploadUrl: 'https://s3/put' })
    mockedApi.uploadFile.mockResolvedValue(undefined)
    mockedApi.processSong.mockResolvedValue({ kind: 'started', songId: 's1', format: 'mp3', jobId: 's1.aaaa' })
    mockedApi.getJob.mockResolvedValue({ jobId: 's1.aaaa', songId: 's1', status: 'QUEUED' } as Job)
    renderWithProviders(<UploadPanel />)
    await pickAndSubmit(audioFile(), 'My Song')
    await waitFor(() => expect(screen.getByText(/queued/i)).toBeInTheDocument())
    expect(mockedApi.createSong).toHaveBeenCalledWith('tok', { title: 'My Song' })
    expect(mockedApi.uploadFile).toHaveBeenCalledWith('https://s3/put', expect.any(File))
    expect(mockedApi.processSong).toHaveBeenCalledWith('tok', 's1')
  })

  it('shows ready immediately on a cache hit and never polls', async () => {
    mockedApi.createSong.mockResolvedValue({ songId: 's2', uploadUrl: 'https://s3/put' })
    mockedApi.uploadFile.mockResolvedValue(undefined)
    mockedApi.processSong.mockResolvedValue({ kind: 'linked', songId: 's2', linkedSongId: 's0', format: 'mp3' })
    renderWithProviders(<UploadPanel />)
    await pickAndSubmit(audioFile())
    await waitFor(() => expect(screen.getByText(/matched an existing song/i)).toBeInTheDocument())
    expect(mockedApi.getJob).not.toHaveBeenCalled()
  })

  it('shows the server rejection reason', async () => {
    mockedApi.createSong.mockResolvedValue({ songId: 's3', uploadUrl: 'https://s3/put' })
    mockedApi.uploadFile.mockResolvedValue(undefined)
    mockedApi.processSong.mockResolvedValue({ kind: 'rejected', songId: 's3', reason: 'unsupported format' })
    renderWithProviders(<UploadPanel />)
    await pickAndSubmit(audioFile())
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('unsupported format'))
  })

  it('start failure offers retry that re-processes without re-uploading', async () => {
    mockedApi.createSong.mockResolvedValue({ songId: 's4', uploadUrl: 'https://s3/put' })
    mockedApi.uploadFile.mockResolvedValue(undefined)
    mockedApi.processSong
      .mockResolvedValueOnce({ kind: 'startFailed', songId: 's4', format: 'mp3', error: 'pipeline failed to start' })
      .mockResolvedValueOnce({ kind: 'started', songId: 's4', format: 'mp3', jobId: 's4.bbbb' })
    mockedApi.getJob.mockResolvedValue({ jobId: 's4.bbbb', songId: 's4', status: 'QUEUED' } as Job)
    renderWithProviders(<UploadPanel />)
    await pickAndSubmit(audioFile())
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('pipeline failed to start'))
    await userEvent.click(screen.getByRole('button', { name: /retry processing/i }))
    await waitFor(() => expect(screen.getByText(/queued/i)).toBeInTheDocument())
    expect(mockedApi.createSong).toHaveBeenCalledTimes(1)
    expect(mockedApi.uploadFile).toHaveBeenCalledTimes(1)
    expect(mockedApi.processSong).toHaveBeenCalledTimes(2)
  })

  it('rejects undersized files client-side with zero API calls', async () => {
    renderWithProviders(<UploadPanel />)
    await pickAndSubmit(audioFile(10 * 1024))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/between 50 KB and 25 MB/i))
    expect(mockedApi.createSong).not.toHaveBeenCalled()
  })

  it('re-presigns once on PUT failure and continues with the new songId', async () => {
    mockedApi.createSong
      .mockResolvedValueOnce({ songId: 'old1', uploadUrl: 'https://s3/put-expired' })
      .mockResolvedValueOnce({ songId: 'new1', uploadUrl: 'https://s3/put-fresh' })
    mockedApi.uploadFile.mockRejectedValueOnce(new Error('403')).mockResolvedValueOnce(undefined)
    mockedApi.processSong.mockResolvedValue({ kind: 'started', songId: 'new1', format: 'mp3', jobId: 'new1.cccc' })
    mockedApi.getJob.mockResolvedValue({ jobId: 'new1.cccc', songId: 'new1', status: 'QUEUED' } as Job)
    renderWithProviders(<UploadPanel />)
    await pickAndSubmit(audioFile())
    await waitFor(() => expect(screen.getByText(/queued/i)).toBeInTheDocument())
    expect(mockedApi.createSong).toHaveBeenCalledTimes(2)
    expect(mockedApi.uploadFile).toHaveBeenNthCalledWith(2, 'https://s3/put-fresh', expect.any(File))
    expect(mockedApi.processSong).toHaveBeenCalledWith('tok', 'new1')
  })
})
