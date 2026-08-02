import { useState, type FormEvent } from 'react'
import heroUrl from '../assets/cadenza-hero-watercolor.png'
import type { View } from '../nav/NavShell'
import logoUrl from '../assets/cadenza-logo.png'
import { Button } from '@/components/ui/button'
import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardFooter,
  GlassCardHeader,
  GlassCardTitle,
} from '@/components/ui/glass-card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from './AuthContext'
import { authErrorMessage } from './authErrors'
import PasswordField from './PasswordField'

type Mode = 'signIn' | 'signUp' | 'confirm' | 'forgot' | 'reset'

// One-shot banner that survives the keyed AuthPage remount when the Shell
// navigates between auth views (e.g. reset success -> sign-in).
const FLASH_KEY = 'cadenza-flash'
// Same-device convenience: the forgot form stores the email so the reset
// page (often opened from the email link) can prefill it.
const RESET_EMAIL_KEY = 'cadenza-reset-email'

function takeFlash(): string | null {
  try {
    const flash = sessionStorage.getItem(FLASH_KEY)
    sessionStorage.removeItem(FLASH_KEY)
    return flash
  } catch {
    return null
  }
}

// Google's "G" - lucide dropped brand icons, so the official four-color mark
// is inlined (same approach as the nav's GitHub/LinkedIn icons).
function GoogleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18A10.97 10.97 0 0 0 1 12c0 1.77.42 3.45 1.18 4.94l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
    </svg>
  )
}

export default function AuthPage({
  initialMode = 'signIn',
  onNavigate,
}: { initialMode?: Mode; onNavigate?: (view: View) => void } = {}) {
  const auth = useAuth()
  const [mode, setMode] = useState<Mode>(initialMode)
  const [email, setEmail] = useState(() => {
    if (initialMode !== 'reset') return ''
    try {
      return sessionStorage.getItem(RESET_EMAIL_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [password, setPassword] = useState('')
  // The reset email links to /reset-password?code={####} - prefill from the URL.
  const [code, setCode] = useState(() =>
    initialMode === 'reset'
      ? (new URLSearchParams(window.location.search).get('code') ?? '')
      : '',
  )
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(takeFlash)
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
      // The pre-sign-up trigger auto-confirms accounts, so go straight in.
      // Legacy safety: if this pool ever demands confirmation again, fall
      // back to the code screen instead of surfacing an error.
      try {
        await auth.signIn(email, password)
      } catch (err) {
        if ((err as { name?: string })?.name === 'UserNotConfirmedException') {
          setMode('confirm')
          return
        }
        throw err
      }
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

  const handleForgot = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      await auth.requestPasswordReset(email)
      try {
        sessionStorage.setItem(RESET_EMAIL_KEY, email)
      } catch {
        /* prefill is best-effort */
      }
      setMode('reset')
      setInfo('Check your email — we sent a reset link and code.')
    })
  }

  const handleReset = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      await auth.confirmPasswordReset(email, code, password)
      try {
        sessionStorage.setItem(FLASH_KEY, 'Password reset — sign in with your new password.')
        sessionStorage.removeItem(RESET_EMAIL_KEY)
      } catch {
        /* flash is best-effort */
      }
      setPassword('')
      setCode('')
      // Sync the URL/view; when we were already on /signin (forgot started
      // from the sign-in card) the keyed remount doesn't fire, so also switch
      // locally — takeFlash() consumes the banner either way.
      onNavigate?.('signin')
      setMode('signIn')
      setInfo(takeFlash() ?? 'Password reset — sign in with your new password.')
    })
  }

  const switchMode = (next: Mode) => {
    setMode(next)
    setError(null)
    setInfo(null)
  }

  const banners = (
    <>
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-md border border-destructive/50 bg-destructive/20 px-3 py-2 text-sm"
        >
          {error}
        </p>
      )}
      {info && (
        <p className="mb-4 rounded-md border border-sage/50 bg-sage/20 px-3 py-2 text-sm">{info}</p>
      )}
    </>
  )

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-5 py-16">
      {/* watercolor backdrop the glass blurs against */}
      <img
        src={heroUrl}
        alt=""
        aria-hidden
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="absolute inset-0 bg-ink/55" />

      <div className="relative z-10 flex w-full max-w-sm flex-col items-center">
        {/* same mark as the browser-tab favicon (cadenza-logo.png) */}
        <img src={logoUrl} alt="" aria-hidden className="hold-bob h-12 w-12" />
        <h1 className="font-content mt-4 text-3xl tracking-tight text-white">cadenza</h1>
        <p className="label-mono mt-2 text-white/70">[ SONGS AS TEXTBOOKS ]</p>

        <GlassCard className="mt-8 w-full">
          {mode === 'signIn' && (
            <>
              <GlassCardHeader>
                <GlassCardDescription className="label-mono text-brass">
                  [ RETURNING LEARNER ]
                </GlassCardDescription>
                <GlassCardTitle className="font-content text-2xl">Welcome back.</GlassCardTitle>
              </GlassCardHeader>
              <GlassCardContent>
                {banners}
                <form onSubmit={handleSignIn} aria-label="Sign in" className="flex flex-col gap-5">
                  <div className="grid gap-2">
                    <Label htmlFor="auth-email">Email</Label>
                    <Input
                      id="auth-email"
                      type="email"
                      placeholder="you@learner.music"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoComplete="email"
                    />
                  </div>
                  <PasswordField
                    value={password}
                    onChange={setPassword}
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    className="label-mono -mt-2 self-end text-white/60 underline-offset-4 hover:text-brass hover:underline"
                    onClick={() => switchMode('forgot')}
                  >
                    Forgot password?
                  </button>
                  <Button type="submit" disabled={pending} className="w-full">
                    Sign in
                  </Button>
                  <div className="flex items-center gap-3 text-white/50">
                    <span className="h-px flex-1 bg-white/20" />
                    <span className="label-mono">or</span>
                    <span className="h-px flex-1 bg-white/20" />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full bg-transparent text-white hover:bg-white/10 hover:text-white"
                    onClick={() => void auth.signInWithGoogle()}
                  >
                    <GoogleMark className="mr-2 h-4 w-4" />
                    Sign in with Google
                  </Button>
                </form>
              </GlassCardContent>
              <GlassCardFooter className="justify-center border-t border-white/15 pt-5">
                <Button variant="link" className="text-brass" onClick={() => switchMode('signUp')}>
                  Need an account? Sign up
                </Button>
              </GlassCardFooter>
            </>
          )}

          {mode === 'signUp' && (
            <>
              <GlassCardHeader>
                <GlassCardDescription className="label-mono text-brass">
                  [ NEW LEARNER ]
                </GlassCardDescription>
                <GlassCardTitle className="font-content text-2xl">Create your account</GlassCardTitle>
              </GlassCardHeader>
              <GlassCardContent>
                {banners}
                <form onSubmit={handleSignUp} aria-label="Sign up" className="flex flex-col gap-5">
                  <div className="grid gap-2">
                    <Label htmlFor="auth-email">Email</Label>
                    <Input
                      id="auth-email"
                      type="email"
                      placeholder="you@learner.music"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoComplete="email"
                    />
                  </div>
                  <PasswordField value={password} onChange={setPassword} autoComplete="new-password" />
                  <p className="text-xs text-white/70">
                    At least 8 characters, with an uppercase letter, a lowercase letter, and a
                    number.
                  </p>
                  <Button type="submit" disabled={pending} className="w-full">
                    Create account
                  </Button>
                </form>
              </GlassCardContent>
              <GlassCardFooter className="justify-center border-t border-white/15 pt-5">
                <Button variant="link" className="text-brass" onClick={() => switchMode('signIn')}>
                  Already have an account? Sign in
                </Button>
              </GlassCardFooter>
            </>
          )}

          {mode === 'confirm' && (
            <>
              <GlassCardHeader>
                <GlassCardTitle>Confirm your account</GlassCardTitle>
                <GlassCardDescription className="text-white/70">
                  We emailed a confirmation code to <strong className="text-white">{email}</strong>.
                </GlassCardDescription>
              </GlassCardHeader>
              <GlassCardContent>
                {banners}
                <form
                  onSubmit={handleConfirm}
                  aria-label="Confirm account"
                  className="flex flex-col gap-5"
                >
                  <div className="grid gap-2">
                    <Label htmlFor="auth-code">Confirmation code</Label>
                    <Input
                      id="auth-code"
                      inputMode="numeric"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      required
                      autoComplete="one-time-code"
                    />
                  </div>
                  <Button type="submit" disabled={pending} className="w-full">
                    Confirm
                  </Button>
                  <Button
                    type="button"
                    variant="link"
                    className="text-brass"
                    onClick={() => void run(() => auth.resendCode(email))}
                  >
                    Resend code
                  </Button>
                </form>
              </GlassCardContent>
            </>
          )}
          {mode === 'forgot' && (
            <>
              <GlassCardHeader>
                <GlassCardDescription className="label-mono text-brass">
                  [ FORGOT PASSWORD ]
                </GlassCardDescription>
                <GlassCardTitle className="font-content text-2xl">
                  Let&apos;s get you back in.
                </GlassCardTitle>
              </GlassCardHeader>
              <GlassCardContent>
                {banners}
                <form
                  onSubmit={handleForgot}
                  aria-label="Forgot password"
                  className="flex flex-col gap-5"
                >
                  <div className="grid gap-2">
                    <Label htmlFor="auth-email">Email</Label>
                    <Input
                      id="auth-email"
                      type="email"
                      placeholder="you@learner.music"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoComplete="email"
                    />
                  </div>
                  <Button type="submit" disabled={pending} className="w-full">
                    Email me a reset link
                  </Button>
                </form>
              </GlassCardContent>
              <GlassCardFooter className="justify-center border-t border-white/15 pt-5">
                <Button variant="link" className="text-brass" onClick={() => switchMode('signIn')}>
                  Back to sign in
                </Button>
              </GlassCardFooter>
            </>
          )}

          {mode === 'reset' && (
            <>
              <GlassCardHeader>
                <GlassCardDescription className="label-mono text-brass">
                  [ RESET PASSWORD ]
                </GlassCardDescription>
                <GlassCardTitle className="font-content text-2xl">
                  Choose a new password.
                </GlassCardTitle>
              </GlassCardHeader>
              <GlassCardContent>
                {banners}
                <form
                  onSubmit={handleReset}
                  aria-label="Reset password"
                  className="flex flex-col gap-5"
                >
                  <div className="grid gap-2">
                    <Label htmlFor="auth-email">Email</Label>
                    <Input
                      id="auth-email"
                      type="email"
                      placeholder="you@learner.music"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoComplete="email"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="auth-reset-code">Reset code</Label>
                    <Input
                      id="auth-reset-code"
                      inputMode="numeric"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      required
                      autoComplete="one-time-code"
                    />
                  </div>
                  <PasswordField
                    label="New password"
                    value={password}
                    onChange={setPassword}
                    autoComplete="new-password"
                  />
                  <p className="text-xs text-white/70">
                    At least 8 characters, with an uppercase letter, a lowercase letter, and a
                    number.
                  </p>
                  <Button type="submit" disabled={pending} className="w-full">
                    Reset password
                  </Button>
                </form>
              </GlassCardContent>
              <GlassCardFooter className="justify-center border-t border-white/15 pt-5">
                <Button variant="link" className="text-brass" onClick={() => switchMode('forgot')}>
                  Need a new code?
                </Button>
              </GlassCardFooter>
            </>
          )}
        </GlassCard>
      </div>
    </div>
  )
}
