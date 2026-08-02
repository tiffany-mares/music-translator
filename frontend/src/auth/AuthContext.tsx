import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import {
  confirmResetPassword as amplifyConfirmResetPassword,
  confirmSignUp as amplifyConfirmSignUp,
  fetchAuthSession,
  resetPassword as amplifyResetPassword,
  signInWithRedirect,
  resendSignUpCode,
  signIn as amplifySignIn,
  signOut as amplifySignOut,
  signUp as amplifySignUp,
} from 'aws-amplify/auth'
import { Hub } from 'aws-amplify/utils'

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
  signInWithGoogle: () => Promise<void>
  requestPasswordReset: (email: string) => Promise<void>
  confirmPasswordReset: (email: string, code: string, newPassword: string) => Promise<void>
  getIdToken: () => Promise<string>
  getOptionalIdToken: () => Promise<string | null>
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
    // OAuth redirect return: Amplify completes the code exchange async after
    // page load and announces it on the Hub - refresh again when it lands.
    const unsubscribe = Hub.listen('auth', ({ payload }) => {
      if (payload.event === 'signInWithRedirect' || payload.event === 'signedIn') void refresh()
    })
    return unsubscribe
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

  // Google federation: full-page redirect to the Cognito hosted UI; Amplify
  // finishes the code exchange when the redirect returns and the Hub effect
  // below refreshes our state.
  const signInWithGoogle = useCallback(async () => {
    await signInWithRedirect({ provider: 'Google' })
  }, [])

  // Forgot-password: Cognito emails a code (our template wraps it in a link
  // to /reset-password); confirm sets the new password.
  const requestPasswordReset = useCallback(async (email: string) => {
    await amplifyResetPassword({ username: email })
  }, [])

  const confirmPasswordReset = useCallback(
    async (email: string, code: string, newPassword: string) => {
      await amplifyConfirmResetPassword({
        username: email,
        confirmationCode: code,
        newPassword,
      })
    },
    [],
  )

  const signOut = useCallback(async () => {
    await amplifySignOut()
    setEmail(null)
    setStatus('signedOut')
  }, [])

  // The API's JWT authorizer validates ID tokens, never access tokens.
  // fetchAuthSession auto-refreshes, so calling per-request keeps tokens fresh.
  const getIdToken = useCallback(async (): Promise<string> => {
    const token = (await fetchAuthSession()).tokens?.idToken?.toString()
    if (!token) throw new Error('No ID token — session expired')
    return token
  }, [])

  // Public routes (Phase 7): signed-out visitors send no auth header at all.
  // Signed-in users still send the token so uploads are attributed to them.
  const getOptionalIdToken = useCallback(async (): Promise<string | null> => {
    try {
      return (await fetchAuthSession()).tokens?.idToken?.toString() ?? null
    } catch {
      return null
    }
  }, [])

  return (
    <AuthContext.Provider
      value={{
        status,
        email,
        signIn,
        signUp,
        confirmSignUp,
        resendCode,
        signOut,
        signInWithGoogle,
        requestPasswordReset,
        confirmPasswordReset,
        getIdToken,
        getOptionalIdToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
