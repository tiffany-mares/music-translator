import { useState, type FormEvent } from 'react'
import { Disc3 } from 'lucide-react'
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

  const inputCls =
    'w-full rounded-[3px] border border-border bg-surface px-4 py-3 text-sm text-foreground outline-none focus:border-brass'
  const labelCls = 'label-mono flex flex-col gap-1.5 text-muted-foreground'
  const submitCls =
    'font-button w-full rounded-[3px] bg-ink px-4 py-3 text-ink-foreground transition-colors hover:bg-brass hover:text-ink disabled:opacity-50'
  const linkCls = 'label-mono text-brass hover:underline'

  return (
    <div className="flex min-h-[80vh] flex-col items-center px-5 pt-20 text-foreground">
      <span className="flex h-10 w-10 items-center justify-center rounded-[3px] bg-ink text-brass">
        <Disc3 className="h-4 w-4" aria-hidden />
      </span>
      <h1 className="font-content mt-6 text-3xl tracking-tight">cadenza</h1>
      <p className="label-mono mt-2 text-muted-foreground">[ SONGS AS TEXTBOOKS ]</p>
      <div className="mt-8 w-full max-w-xs">
      {error && (
        <p role="alert" className="mb-3 rounded-[3px] border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {info && <p className="mb-3 rounded-[3px] border border-sage/40 bg-sage/10 px-3 py-2 text-sm text-sage">{info}</p>}

      {mode === 'signIn' && (
        <form onSubmit={handleSignIn} aria-label="Sign in" className="space-y-3">
          <label className={labelCls}>
            Email
            <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </label>
          <label className={labelCls}>
            Password
            <input
              className={inputCls}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </label>
          <button type="submit" disabled={pending} className={submitCls}>
            Sign in
          </button>
          <p className="pt-1 text-center">
            <button type="button" className={linkCls} onClick={() => switchMode('signUp')}>
              Need an account? Sign up
            </button>
          </p>
        </form>
      )}

      {mode === 'signUp' && (
        <form onSubmit={handleSignUp} aria-label="Sign up" className="space-y-3">
          <label className={labelCls}>
            Email
            <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </label>
          <label className={labelCls}>
            Password
            <input
              className={inputCls}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
            />
          </label>
          <p className="text-xs text-muted-foreground">At least 12 characters, with an uppercase letter, a lowercase letter, and a number.</p>
          <button type="submit" disabled={pending} className={submitCls}>
            Create account
          </button>
          <p className="pt-1 text-center">
            <button type="button" className={linkCls} onClick={() => switchMode('signIn')}>
              Already have an account? Sign in
            </button>
          </p>
        </form>
      )}

      {mode === 'confirm' && (
        <form onSubmit={handleConfirm} aria-label="Confirm account" className="space-y-3">
          <p className="text-sm text-muted-foreground">
            We emailed a confirmation code to <strong className="text-foreground">{email}</strong>.
          </p>
          <label className={labelCls}>
            Confirmation code
            <input
              className={inputCls}
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              autoComplete="one-time-code"
            />
          </label>
          <button type="submit" disabled={pending} className={submitCls}>
            Confirm
          </button>
          <p className="pt-1 text-center">
            <button type="button" className={linkCls} onClick={() => void run(() => auth.resendCode(email))}>
              Resend code
            </button>
          </p>
        </form>
      )}
      </div>
    </div>
  )
}
