import { screen, within } from '@testing-library/react'
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

// Phase 7: the shell renders for everyone; the auth form lives behind the
// Sign in nav item, and "Sign in" now names BOTH that nav item and the form's
// submit - form interactions are scoped with within() to disambiguate.
async function openAuthView() {
  // Sign in moved from the nav footer to the Profile page.
  await userEvent.click(await screen.findByRole('button', { name: 'Profile' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }))
}

function signInForm() {
  return within(screen.getByRole('form', { name: /sign in/i }))
}

async function fillSignIn(email: string, password: string) {
  await openAuthView()
  await userEvent.type(signInForm().getByLabelText(/email/i), email)
  await userEvent.type(signInForm().getByLabelText(/password/i, { selector: 'input' }), password)
  // exact name: /sign in/i would also match 'Sign in with Google'
  await userEvent.click(signInForm().getByRole('button', { name: 'Sign in' }))
}

async function fillSignUp(email: string, password: string) {
  await openAuthView()
  await userEvent.click(await screen.findByRole('button', { name: /sign up/i }))
  await userEvent.type(screen.getByLabelText(/email/i), email)
  await userEvent.type(screen.getByLabelText(/password/i, { selector: 'input' }), password)
  await userEvent.click(screen.getByRole('button', { name: /create account/i }))
}

// The full marketing pages now mount with the shell; userEvent interactions
// over that much DOM push some tests past the default 5s timeout in jsdom.
vi.setConfig({ testTimeout: 15000 })

describe('AuthPage', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    // Deep-link sync (urlView): pushState from earlier tests persists on the
    // shared jsdom location - start every test at the home path.
    window.history.replaceState(null, '', '/')
  })

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

  // Phase: no-email-verification - the pre-sign-up trigger auto-confirms, so
  // signup signs straight in with no code screen.
  it('signs up and signs straight in (no confirmation step)', async () => {
    renderSignedOut()
    mocked.signUp.mockResolvedValue({} as Awaited<ReturnType<typeof amplifyAuth.signUp>>)
    mocked.signIn.mockResolvedValue(DONE)
    mocked.fetchAuthSession.mockResolvedValue(signedIn)
    await fillSignUp('new@user.dev', 'Password12345')
    expect(mocked.signUp).toHaveBeenCalledWith({
      username: 'new@user.dev',
      password: 'Password12345',
      options: { userAttributes: { email: 'new@user.dev' } },
    })
    expect(mocked.signIn).toHaveBeenCalledWith({ username: 'new@user.dev', password: 'Password12345' })
    expect(await screen.findByText('new@user.dev')).toBeInTheDocument()
  })

  it('falls back to the confirm form if the pool still demands confirmation', async () => {
    renderSignedOut()
    mocked.signUp.mockResolvedValue({} as Awaited<ReturnType<typeof amplifyAuth.signUp>>)
    mocked.signIn.mockRejectedValue({ name: 'UserNotConfirmedException' })
    await fillSignUp('new@user.dev', 'Password12345')
    expect(await screen.findByRole('form', { name: /confirm/i })).toBeInTheDocument()
  })

  it('shows mapped error when the email is already registered', async () => {
    renderSignedOut()
    mocked.signUp.mockRejectedValue({ name: 'UsernameExistsException' })
    await fillSignUp('new@user.dev', 'Password12345')
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists')
  })

  it('confirms then auto-signs-in with the retained password (legacy fallback path)', async () => {
    renderSignedOut()
    mocked.signUp.mockResolvedValue({} as Awaited<ReturnType<typeof amplifyAuth.signUp>>)
    mocked.confirmSignUp.mockResolvedValue({} as Awaited<ReturnType<typeof amplifyAuth.confirmSignUp>>)
    // first sign-in attempt (post-signup) hits the unconfirmed fallback; the
    // post-confirm one succeeds
    mocked.signIn
      .mockRejectedValueOnce({ name: 'UserNotConfirmedException' })
      .mockResolvedValue(DONE)
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
    mocked.signIn.mockRejectedValue({ name: 'UserNotConfirmedException' })
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
    expect(signInForm().getByRole('button', { name: 'Sign in' })).toBeDisabled()
    release(DONE)
  })
})

// --- Google federation ------------------------------------------------------

describe('Sign in with Google', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    window.history.replaceState(null, '', '/')
  })

  it('starts the redirect flow with the Google provider', async () => {
    mocked.fetchAuthSession.mockResolvedValue(signedOut)
    mocked.signInWithRedirect.mockResolvedValue(undefined as never)
    renderWithProviders(<App />)
    await openAuthView()
    await userEvent.click(screen.getByRole('button', { name: /sign in with google/i }))
    expect(mocked.signInWithRedirect).toHaveBeenCalledWith({ provider: 'Google' })
  })
})

// --- Forgot / reset password -------------------------------------------------

describe('forgot password flow', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    window.history.replaceState(null, '', '/')
    sessionStorage.clear()
    mocked.fetchAuthSession.mockResolvedValue(signedOut)
  })

  it('Forgot password? opens the request form; submitting emails a reset and moves to the reset form', async () => {
    mocked.resetPassword.mockResolvedValue({} as Awaited<ReturnType<typeof amplifyAuth.resetPassword>>)
    renderWithProviders(<App />)
    await openAuthView()
    await userEvent.click(screen.getByRole('button', { name: /forgot password/i }))
    const forgot = screen.getByRole('form', { name: /forgot password/i })
    await userEvent.type(within(forgot).getByLabelText(/email/i), 'lost@user.dev')
    await userEvent.click(within(forgot).getByRole('button', { name: /email me a reset link/i }))
    expect(mocked.resetPassword).toHaveBeenCalledWith({ username: 'lost@user.dev' })
    expect(await screen.findByRole('form', { name: /reset password/i })).toBeInTheDocument()
    expect(screen.getByText(/check your email/i)).toBeInTheDocument()
    // email carried over for the confirm step
    expect(screen.getByLabelText(/email/i, { selector: 'input' })).toHaveValue('lost@user.dev')
  })

  it('completing the reset returns to sign-in with a success banner', async () => {
    mocked.resetPassword.mockResolvedValue({} as Awaited<ReturnType<typeof amplifyAuth.resetPassword>>)
    mocked.confirmResetPassword.mockResolvedValue(undefined as never)
    renderWithProviders(<App />)
    await openAuthView()
    await userEvent.click(screen.getByRole('button', { name: /forgot password/i }))
    const forgot = screen.getByRole('form', { name: /forgot password/i })
    await userEvent.type(within(forgot).getByLabelText(/email/i), 'lost@user.dev')
    await userEvent.click(within(forgot).getByRole('button', { name: /email me a reset link/i }))
    const reset = await screen.findByRole('form', { name: /reset password/i })
    await userEvent.type(within(reset).getByLabelText(/reset code/i), '123456')
    await userEvent.type(
      within(reset).getByLabelText(/new password/i, { selector: 'input' }),
      'FreshPass123',
    )
    await userEvent.click(within(reset).getByRole('button', { name: /^reset password$/i }))
    expect(mocked.confirmResetPassword).toHaveBeenCalledWith({
      username: 'lost@user.dev',
      confirmationCode: '123456',
      newPassword: 'FreshPass123',
    })
    // back on the sign-in card with the flash banner
    expect(await screen.findByRole('form', { name: /sign in/i })).toBeInTheDocument()
    expect(screen.getByText(/password reset — sign in with your new password/i)).toBeInTheDocument()
    expect(window.location.pathname).toBe('/signin')
  })

  it('/reset-password?code=999999 deep link opens the reset form with the code prefilled', async () => {
    window.history.replaceState(null, '', '/reset-password?code=999999')
    renderWithProviders(<App />)
    const reset = await screen.findByRole('form', { name: /reset password/i })
    expect(within(reset).getByLabelText(/reset code/i)).toHaveValue('999999')
  })
})
