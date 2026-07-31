import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as amplifyAuth from 'aws-amplify/auth'
import App from '../App'
import { renderWithProviders } from '../test/renderWithProviders'

vi.mock('aws-amplify/auth')
// The signed-in Shell mounts UploadPanel, whose top-level useJobPolling needs a
// QueryClient (since 4.5) - so this suite renders with the full provider stack.
vi.mock('../api/client')
const mocked = vi.mocked(amplifyAuth)

type Session = Awaited<ReturnType<typeof amplifyAuth.fetchAuthSession>>
const signedOut = {} as Session
const signedIn = {
  tokens: { idToken: { payload: { email: 'new@user.dev' } } },
} as unknown as Session

type SignInOutput = Awaited<ReturnType<typeof amplifyAuth.signIn>>
const DONE = { isSignedIn: true, nextStep: { signInStep: 'DONE' } } as SignInOutput
const NEEDS_CONFIRM = { isSignedIn: false, nextStep: { signInStep: 'CONFIRM_SIGN_UP' } } as SignInOutput

function renderSignedOut() {
  mocked.fetchAuthSession.mockResolvedValueOnce(signedOut)
  return renderWithProviders(<App />)
}

async function fillSignIn(email: string, password: string) {
  await userEvent.type(await screen.findByLabelText(/email/i), email)
  await userEvent.type(screen.getByLabelText(/password/i), password)
  await userEvent.click(screen.getByRole('button', { name: /sign in/i }))
}

async function fillSignUp(email: string, password: string) {
  await userEvent.click(await screen.findByRole('button', { name: /sign up/i }))
  await userEvent.type(screen.getByLabelText(/email/i), email)
  await userEvent.type(screen.getByLabelText(/password/i), password)
  await userEvent.click(screen.getByRole('button', { name: /create account/i }))
}

describe('AuthPage', () => {
  beforeEach(() => vi.resetAllMocks())

  it('signs in and shows the shell', async () => {
    renderSignedOut()
    mocked.signIn.mockResolvedValue(DONE)
    mocked.fetchAuthSession.mockResolvedValue(signedIn)
    await fillSignIn('new@user.dev', 'Password12345')
    expect(mocked.signIn).toHaveBeenCalledWith({ username: 'new@user.dev', password: 'Password12345' })
    expect(await screen.findByText('new@user.dev')).toBeInTheDocument()
  })

  it('shows mapped error on wrong password and stays on the form', async () => {
    renderSignedOut()
    mocked.signIn.mockRejectedValue({ name: 'NotAuthorizedException' })
    await fillSignIn('new@user.dev', 'WrongPassword1')
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.')
    expect(screen.getByLabelText(/email/i)).toHaveValue('new@user.dev')
  })

  it('routes an unconfirmed sign-in to the confirm form', async () => {
    renderSignedOut()
    mocked.signIn.mockResolvedValue(NEEDS_CONFIRM)
    await fillSignIn('new@user.dev', 'Password12345')
    expect(await screen.findByRole('form', { name: /confirm/i })).toBeInTheDocument()
  })

  it('signs up then shows the confirm form', async () => {
    renderSignedOut()
    mocked.signUp.mockResolvedValue({} as Awaited<ReturnType<typeof amplifyAuth.signUp>>)
    await fillSignUp('new@user.dev', 'Password12345')
    expect(mocked.signUp).toHaveBeenCalledWith({
      username: 'new@user.dev',
      password: 'Password12345',
      options: { userAttributes: { email: 'new@user.dev' } },
    })
    expect(await screen.findByRole('form', { name: /confirm/i })).toBeInTheDocument()
  })

  it('shows mapped error when the email is already registered', async () => {
    renderSignedOut()
    mocked.signUp.mockRejectedValue({ name: 'UsernameExistsException' })
    await fillSignUp('new@user.dev', 'Password12345')
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists')
  })

  it('confirms then auto-signs-in with the retained password', async () => {
    renderSignedOut()
    mocked.signUp.mockResolvedValue({} as Awaited<ReturnType<typeof amplifyAuth.signUp>>)
    mocked.confirmSignUp.mockResolvedValue({} as Awaited<ReturnType<typeof amplifyAuth.confirmSignUp>>)
    mocked.signIn.mockResolvedValue(DONE)
    mocked.fetchAuthSession.mockResolvedValue(signedIn)
    await fillSignUp('new@user.dev', 'Password12345')
    await userEvent.type(await screen.findByLabelText(/code/i), '123456')
    await userEvent.click(screen.getByRole('button', { name: /^confirm$/i }))
    expect(mocked.confirmSignUp).toHaveBeenCalledWith({ username: 'new@user.dev', confirmationCode: '123456' })
    expect(mocked.signIn).toHaveBeenCalledWith({ username: 'new@user.dev', password: 'Password12345' })
    expect(await screen.findByText('new@user.dev')).toBeInTheDocument()
  })

  it('shows mapped error on a wrong confirmation code and stays on confirm', async () => {
    renderSignedOut()
    mocked.signUp.mockResolvedValue({} as Awaited<ReturnType<typeof amplifyAuth.signUp>>)
    mocked.confirmSignUp.mockRejectedValue({ name: 'CodeMismatchException' })
    await fillSignUp('new@user.dev', 'Password12345')
    await userEvent.type(await screen.findByLabelText(/code/i), '000000')
    await userEvent.click(screen.getByRole('button', { name: /^confirm$/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent("doesn't match")
    expect(screen.getByRole('form', { name: /confirm/i })).toBeInTheDocument()
  })

  it('disables the submit button while sign-in is pending', async () => {
    renderSignedOut()
    let release!: (v: SignInOutput) => void
    mocked.signIn.mockImplementation(() => new Promise((res) => (release = res)))
    await fillSignIn('new@user.dev', 'Password12345')
    expect(screen.getByRole('button', { name: /sign in/i })).toBeDisabled()
    release(DONE)
  })
})
