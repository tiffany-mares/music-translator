import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as amplifyAuth from 'aws-amplify/auth'
import * as api from '../api/client'
import type { SongListing } from '../api/types'
import { renderWithProviders } from '../test/renderWithProviders'
import LibraryView from './LibraryView'

vi.mock('aws-amplify/auth')
vi.mock('../api/client')
const mockedAuth = vi.mocked(amplifyAuth)
const mockedApi = vi.mocked(api)

const song = (songId: string, title: string, sourceLanguage: string | null): SongListing => ({
  songId,
  title,
  artist: 'O-Zone',
  status: 'VALIDATED',
  createdAt: `2026-07-0${songId.length}T00:00:00+00:00`,
  sourceLanguage,
})

describe('LibraryView', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedAuth.fetchAuthSession.mockResolvedValue({} as never)
    mockedApi.getAudioUrls.mockResolvedValue({ urls: { raw: 'https://s3/raw?x' }, expiresInSeconds: 900 })
    mockedApi.getLyrics.mockResolvedValue({
      songId: 's1', sourceLanguage: 'ro', targetLanguage: 'en', lines: [],
    })
    mockedApi.getMyLibrary.mockResolvedValue({ songIds: [], count: 0 })
  })

  it('lists fetched songs with their language', async () => {
    mockedApi.getSongs.mockResolvedValue([song('s1', 'Dragostea', 'ro'), song('s2', 'Amour', 'fr')])
    renderWithProviders(<LibraryView onNavigate={vi.fn()} />)
    expect(await screen.findByText('Dragostea')).toBeInTheDocument()
    expect(screen.getByText('Amour')).toBeInTheDocument()
    expect(screen.getByText(/2 songs/i)).toBeInTheDocument()
  })

  it('language filter narrows the grid', async () => {
    mockedApi.getSongs.mockResolvedValue([song('s1', 'Dragostea', 'ro'), song('s2', 'Amour', 'fr')])
    renderWithProviders(<LibraryView onNavigate={vi.fn()} />)
    await screen.findByText('Dragostea')
    await userEvent.selectOptions(screen.getByLabelText(/filter by language/i), 'fr')
    expect(screen.queryByText('Dragostea')).not.toBeInTheDocument()
    expect(screen.getByText('Amour')).toBeInTheDocument()
    expect(screen.getByText(/1 song\b/i)).toBeInTheDocument()
  })

  it('empty catalog shows the add-first-song state routing to Upload', async () => {
    mockedApi.getSongs.mockResolvedValue([])
    const onNavigate = vi.fn()
    renderWithProviders(<LibraryView onNavigate={onNavigate} />)
    await userEvent.click(await screen.findByRole('button', { name: /upload a song/i }))
    expect(onNavigate).toHaveBeenCalledWith('upload')
  })

  it('clicking a song card opens the embedded player; back returns to the grid', async () => {
    mockedApi.getSongs.mockResolvedValue([song('s1', 'Dragostea', 'ro')])
    renderWithProviders(<LibraryView onNavigate={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: /dragostea/i }))
    await waitFor(() => expect(screen.getByTestId('player-audio')).toBeInTheDocument())
    // Signed-out session -> the public client sends a null token.
    expect(mockedApi.getAudioUrls).toHaveBeenCalledWith(null, 's1')
    await userEvent.click(screen.getByRole('button', { name: /back to library/i }))
    expect(screen.queryByTestId('player-audio')).not.toBeInTheDocument()
    expect(screen.getByText('Dragostea')).toBeInTheDocument()
  })
})

// --- Personal library (signed-in shelf + signed-out prompt) ------------------

describe('My library section', () => {
  const signedInSession = {
    tokens: { idToken: { toString: () => 'tok', payload: { email: 'x@y.com' } } },
  } as never

  beforeEach(() => {
    vi.resetAllMocks()
    mockedApi.getAudioUrls.mockResolvedValue({ urls: { raw: 'https://s3/raw?x' }, expiresInSeconds: 900 })
    mockedApi.getLyrics.mockResolvedValue({ songId: 's1', sourceLanguage: 'ro', targetLanguage: 'en', lines: [] })
  })

  it('signed out: shows the sign-in prompt and no bookmark buttons', async () => {
    mockedAuth.fetchAuthSession.mockResolvedValue({} as never)
    mockedApi.getSongs.mockResolvedValue([song('s1', 'Dragostea', 'ro')])
    const onNavigate = vi.fn()
    renderWithProviders(<LibraryView onNavigate={onNavigate} />)
    await screen.findByText('Dragostea')
    const section = screen.getByRole('region', { name: /my library/i })
    await userEvent.click(within(section).getByRole('button', { name: 'Sign in' }))
    expect(onNavigate).toHaveBeenCalledWith('signin')
    expect(screen.queryByRole('button', { name: /save .* to my library/i })).not.toBeInTheDocument()
  })

  it('signed in: bookmarking a catalog song adds it to the shelf; removing takes it off', async () => {
    mockedAuth.fetchAuthSession.mockResolvedValue(signedInSession)
    mockedApi.getSongs.mockResolvedValue([song('s1', 'Dragostea', 'ro')])
    mockedApi.getMyLibrary
      .mockResolvedValueOnce({ songIds: [], count: 0 })
      .mockResolvedValue({ songIds: ['s1'], count: 1 })
    mockedApi.addToMyLibrary.mockResolvedValue(undefined)
    mockedApi.removeFromMyLibrary.mockResolvedValue(undefined)
    renderWithProviders(<LibraryView onNavigate={vi.fn()} />)
    await screen.findByText('Dragostea')
    expect(await screen.findByText(/no saved songs yet/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /save dragostea to my library/i }))
    expect(mockedApi.addToMyLibrary).toHaveBeenCalledWith('tok', 's1')
    // invalidation refetch returns the saved list -> shelf shows the song
    const section = screen.getByRole('region', { name: /my library/i })
    expect(await within(section).findByText('Dragostea')).toBeInTheDocument()
    await userEvent.click(
      within(section).getByRole('button', { name: /remove dragostea from my library/i }),
    )
    expect(mockedApi.removeFromMyLibrary).toHaveBeenCalledWith('tok', 's1')
  })
})
