import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as amplifyAuth from 'aws-amplify/auth'
import * as api from '../api/client'
import { renderWithProviders } from '../test/renderWithProviders'
import ProfileView from './ProfileView'

vi.mock('aws-amplify/auth')
vi.mock('../api/client')
const mockedAuth = vi.mocked(amplifyAuth)
const mockedApi = vi.mocked(api)

type Session = Awaited<ReturnType<typeof amplifyAuth.fetchAuthSession>>
const signedIn = {
  tokens: { idToken: { toString: () => 'tok', payload: { email: 'x@y.com' } } },
} as unknown as Session

describe('ProfileView', () => {
  beforeEach(() => vi.resetAllMocks())

  it('signed out: picking a language warns to sign in first; Sign in lives at the bottom', async () => {
    mockedAuth.fetchAuthSession.mockResolvedValue({} as Session)
    const onNavigate = vi.fn()
    renderWithProviders(<ProfileView onNavigate={onNavigate} />)
    await userEvent.selectOptions(screen.getByLabelText(/target language/i), 'es')
    expect(await screen.findByRole('alert')).toHaveTextContent(/signed in first/i)
    expect(mockedApi.putProfile).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(onNavigate).toHaveBeenCalledWith('signin')
  })

  it('signed in: loads the saved language and persists a new pick', async () => {
    mockedAuth.fetchAuthSession.mockResolvedValue(signedIn)
    mockedApi.getProfile.mockResolvedValue({ targetLanguage: 'en' })
    mockedApi.putProfile.mockResolvedValue({ targetLanguage: 'es' })
    renderWithProviders(<ProfileView onNavigate={vi.fn()} />)
    const select = screen.getByLabelText(/target language/i)
    await userEvent.selectOptions(select, 'es')
    expect(mockedApi.putProfile).toHaveBeenCalledWith('tok', 'es')
    expect(await screen.findByText('Saved.')).toBeInTheDocument()
  })

  it('signed in: shows the email and Sign out at the bottom', async () => {
    mockedAuth.fetchAuthSession.mockResolvedValue(signedIn)
    mockedApi.getProfile.mockResolvedValue({ targetLanguage: null })
    mockedAuth.signOut.mockResolvedValue(undefined as never)
    renderWithProviders(<ProfileView onNavigate={vi.fn()} />)
    expect(await screen.findByText('x@y.com')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /sign out/i }))
    expect(mockedAuth.signOut).toHaveBeenCalled()
  })
})
