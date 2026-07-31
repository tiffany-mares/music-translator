import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import {
  confirmSignUp as amplifyConfirmSignUp,
  fetchAuthSession,
  resendSignUpCode,
  signIn as amplifySignIn,
  signOut as amplifySignOut,
  signUp as amplifySignUp,
} from 'aws-amplify/auth'

type AuthStatus = 'loading' | 'signedOut' | 'signedIn'
type SignInResult = 'DONE' | 'CONFIRM'

interface AuthContextValue {
  status: AuthStatus
  email: string | null
  signIn: (email: string, password: string) => Promise<SignInResult>
  signUp: (email: string, password: string) => Promise<void>
  confirmSignUp: (email: string, code: string) => Promise<void>
  resendCode: (email: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [email, setEmail] = useState<string | null>(null)

  // One call bootstraps everything: the ID-token payload already carries email,
  // and the ID token is also what the API's JWT authorizer consumes (not access).
  const refresh = useCallback(async () => {
    try {
      const session = await fetchAuthSession()
      const tokenEmail = session.tokens?.idToken?.payload?.email
      if (typeof tokenEmail === 'string') {
        setEmail(tokenEmail)
        setStatus('signedIn')
        return
      }
    } catch {
      // fall through to signedOut
    }
    setEmail(null)
    setStatus('signedOut')
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const signIn = useCallback(
    async (username: string, password: string): Promise<SignInResult> => {
      const { nextStep } = await amplifySignIn({ username, password })
      if (nextStep.signInStep === 'CONFIRM_SIGN_UP') return 'CONFIRM'
      await refresh()
      return 'DONE'
    },
    [refresh],
  )

  const signUp = useCallback(async (username: string, password: string) => {
    await amplifySignUp({ username, password, options: { userAttributes: { email: username } } })
  }, [])

  const confirmSignUp = useCallback(async (username: string, code: string) => {
    await amplifyConfirmSignUp({ username, confirmationCode: code })
  }, [])

  const resendCode = useCallback(async (username: string) => {
    await resendSignUpCode({ username })
  }, [])

  const signOut = useCallback(async () => {
    await amplifySignOut()
    setEmail(null)
    setStatus('signedOut')
  }, [])

  return (
    <AuthContext.Provider value={{ status, email, signIn, signUp, confirmSignUp, resendCode, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
