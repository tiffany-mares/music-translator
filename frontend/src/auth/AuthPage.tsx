import { useState, type FormEvent } from 'react'
import { Disc3 } from 'lucide-react'
import heroUrl from '../assets/cadenza-hero-watercolor.png'
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

type Mode = 'signIn' | 'signUp' | 'confirm'

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
        <span className="hold-bob flex h-10 w-10 items-center justify-center rounded-[3px] bg-ink text-brass">
          <Disc3 className="h-4 w-4" aria-hidden />
        </span>
        <h1 className="font-content mt-4 text-3xl tracking-tight text-white">cadenza</h1>
        <p className="label-mono mt-2 text-white/70">[ SONGS AS TEXTBOOKS ]</p>

        <GlassCard className="mt-8 w-full">
          {mode === 'signIn' && (
            <>
              <GlassCardHeader>
                <GlassCardTitle>Sign in to your account</GlassCardTitle>
                <GlassCardDescription className="text-white/70">
                  Your saved words and review queue live here.
                </GlassCardDescription>
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
                <GlassCardTitle>Create your account</GlassCardTitle>
                <GlassCardDescription className="text-white/70">
                  Free — it syncs your vocabulary across devices.
                </GlassCardDescription>
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
                    At least 12 characters, with an uppercase letter, a lowercase letter, and a
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
        </GlassCard>
      </div>
    </div>
  )
}
