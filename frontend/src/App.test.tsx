import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as amplifyAuth from 'aws-amplify/auth'
import * as api from './api/client'
import App from './App'
import { renderWithProviders } from './test/renderWithProviders'

vi.mock('aws-amplify/auth')
// Shell renders UploadPanel; mock the api module so no real fetch layer loads.
vi.mock('./api/client')
const mocked = vi.mocked(amplifyAuth)
const mockedApi = vi.mocked(api)

type Session = Awaited<ReturnType<typeof amplifyAuth.fetchAuthSession>>
const signedOutSession = {} as Session
const signedInSession = {
  tokens: { idToken: { payload: { email: 'x@y.com' } } },
} as unknown as Session

function renderApp() {
  return renderWithProviders(<App />)
}

describe('App auth states', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    // Shell mounts useDueVocab; an auto-mock resolving undefined would log
    // React Query "data cannot be undefined" noise in every signed-in test.
    mockedApi.getDueVocab.mockResolvedValue({ items: [], count: 0 })
  })

  // Phase 7: signed out no longer gates the app - the full shell renders with
  // a Sign in nav item; the form appears only when that view is opened.
  it('shows loading, then the public shell with a Sign in nav item when no session exists', async () => {
    mocked.fetchAuthSession.mockResolvedValue(signedOutSession)
    renderApp()
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(screen.getByRole('form', { name: /sign in/i })).toBeInTheDocument()
  })

  it('shows the shell with the user email when a session exists', async () => {
    mocked.fetchAuthSession.mockResolvedValue(signedInSession)
    renderApp()
    expect(await screen.findByText('x@y.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument()
  })

  it('signs out back to the anonymous shell', async () => {
    mocked.fetchAuthSession.mockResolvedValue(signedInSession)
    mocked.signOut.mockResolvedValue(undefined as never)
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: /sign out/i }))
    expect(mocked.signOut).toHaveBeenCalled()
    // Back to the anonymous shell: the Sign in nav item returns.
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })
})
