import { useState, type FormEvent } from 'react'
import { useAuth } from './AuthContext'
import { authErrorMessage } from './authErrors'

type Mode = 'signIn' | 'signUp' | 'confirm'

export default function AuthPage() {
  const auth = useAuth()
  const [mode, setMode] = useState<Mode>('signIn')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const run = async (fn: () => Promise<void>) => {
    setError(null)
    setInfo(null)
    setPending(true)
    try {
      await fn()
    } catch (err) {
      setError(authErrorMessage(err))
    } finally {
      setPending(false)
    }
  }

  const handleSignIn = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      try {
        const result = await auth.signIn(email, password)
        if (result === 'CONFIRM') setMode('confirm')
      } catch (err) {
        if ((err as { name?: string })?.name === 'UserNotConfirmedException') {
          setMode('confirm')
          return
        }
        throw err
      }
    })
  }

  const handleSignUp = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      await auth.signUp(email, password)
      setMode('confirm')
    })
  }

  const handleConfirm = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      await auth.confirmSignUp(email, code)
      if (password) {
        await auth.signIn(email, password)
      } else {
        // Arrived here from an unconfirmed sign-in attempt; no password retained.
        setMode('signIn')
        setInfo('Account confirmed — sign in.')
      }
    })
  }

  const switchMode = (next: Mode) => {
    setMode(next)
    setError(null)
    setInfo(null)
  }

  return (
    <div className="auth-page">
      <h1 className="wordmark">Cadenza</h1>
      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}
      {info && <p className="auth-info">{info}</p>}

      {mode === 'signIn' && (
        <form onSubmit={handleSignIn} aria-label="Sign in">
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </label>
          <button type="submit" disabled={pending}>
            Sign in
          </button>
          <p>
            <button type="button" className="link" onClick={() => switchMode('signUp')}>
              Need an account? Sign up
            </button>
          </p>
        </form>
      )}

      {mode === 'signUp' && (
        <form onSubmit={handleSignUp} aria-label="Sign up">
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
            />
          </label>
          <p className="hint">At least 12 characters, with an uppercase letter, a lowercase letter, and a number.</p>
          <button type="submit" disabled={pending}>
            Create account
          </button>
          <p>
            <button type="button" className="link" onClick={() => switchMode('signIn')}>
              Already have an account? Sign in
            </button>
          </p>
        </form>
      )}

      {mode === 'confirm' && (
        <form onSubmit={handleConfirm} aria-label="Confirm account">
          <p>
            We emailed a confirmation code to <strong>{email}</strong>.
          </p>
          <label>
            Confirmation code
            <input
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              autoComplete="one-time-code"
            />
          </label>
          <button type="submit" disabled={pending}>
            Confirm
          </button>
          <p>
            <button type="button" className="link" onClick={() => void run(() => auth.resendCode(email))}>
              Resend code
            </button>
          </p>
        </form>
      )}
    </div>
  )
}
