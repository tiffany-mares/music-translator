import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as amplifyAuth from 'aws-amplify/auth'
import App from './App'
import { AuthProvider } from './auth/AuthContext'

vi.mock('aws-amplify/auth')
const mocked = vi.mocked(amplifyAuth)

type Session = Awaited<ReturnType<typeof amplifyAuth.fetchAuthSession>>
const signedOutSession = {} as Session
const signedInSession = {
  tokens: { idToken: { payload: { email: 'x@y.com' } } },
} as unknown as Session

function renderApp() {
  return render(
    <AuthProvider>
      <App />
    </AuthProvider>,
  )
}

describe('App auth states', () => {
  beforeEach(() => vi.resetAllMocks())

  it('shows loading, then the sign-in form when no session exists', async () => {
    mocked.fetchAuthSession.mockResolvedValue(signedOutSession)
    renderApp()
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
    expect(await screen.findByRole('form', { name: /sign in/i })).toBeInTheDocument()
  })

  it('shows the shell with the user email when a session exists', async () => {
    mocked.fetchAuthSession.mockResolvedValue(signedInSession)
    renderApp()
    expect(await screen.findByText('x@y.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument()
  })

  it('signs out back to the sign-in form', async () => {
    mocked.fetchAuthSession.mockResolvedValue(signedInSession)
    mocked.signOut.mockResolvedValue(undefined as never)
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: /sign out/i }))
    expect(mocked.signOut).toHaveBeenCalled()
    expect(await screen.findByRole('form', { name: /sign in/i })).toBeInTheDocument()
  })
})
