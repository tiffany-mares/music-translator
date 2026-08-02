import { useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import type { View } from '../nav/NavShell'
import { useProfile, useSaveProfile } from './useProfile'

export const TARGET_LANGUAGES: [string, string][] = [
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['de', 'German'],
  ['it', 'Italian'],
  ['pt', 'Portuguese'],
  ['ro', 'Romanian'],
]

// The Profile view: target-language preference (per-account, stored on the
// learning service) + the sign in/out affordances, which moved here from the
// nav footer. Signed-out visitors can browse but not save - trying to pick a
// language explains why.
export default function ProfileView({ onNavigate }: { onNavigate: (view: View) => void }) {
  const { status, email, signOut } = useAuth()
  const signedIn = status === 'signedIn'
  const { data: profile, isError } = useProfile()
  const save = useSaveProfile()
  const [needsSignIn, setNeedsSignIn] = useState(false)

  const current = profile?.targetLanguage ?? ''

  const handleSelect = (value: string) => {
    if (!signedIn) {
      setNeedsSignIn(true)
      return
    }
    setNeedsSignIn(false)
    if (value) save.mutate(value)
  }

  return (
    <section className="mx-auto flex max-w-xl flex-col gap-8 px-6 py-14">
      <div>
        <p className="label-mono text-brass">[ PROFILE ]</p>
        <h1 className="font-content pt-3 text-4xl font-semibold tracking-[-0.02em]">
          Tune your learning.
        </h1>
      </div>

      <div className="corner-ticks plate flex flex-col gap-3 rounded-[10px] p-6">
        <label className="label-mono flex flex-col gap-2 text-muted-foreground">
          Target language
          <select
            aria-label="Target language"
            value={current}
            onChange={(e) => handleSelect(e.target.value)}
            className="label-mono w-full max-w-xs cursor-pointer rounded-[3px] border border-border bg-surface px-3 py-2.5 text-foreground outline-none focus:border-brass"
          >
            <option value="" disabled>
              Choose a language…
            </option>
            {TARGET_LANGUAGES.map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {needsSignIn && (
          <p role="alert" className="auth-error">
            You need to be signed in first to choose a target language.
          </p>
        )}
        {signedIn && isError && (
          <p role="alert" className="auth-error">
            Couldn&apos;t load your profile.
          </p>
        )}
        {signedIn && save.isSuccess && !save.isPending && (
          <p className="label-mono text-sage">Saved.</p>
        )}
        {signedIn && save.isError && (
          <p role="alert" className="auth-error">
            Couldn&apos;t save that — try again.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Translations currently ship in English; your preference is saved for when more target
          languages arrive. Don&apos;t see yours?{' '}
          <a
            className="text-brass underline-offset-4 hover:underline"
            href="mailto:tiffany.m.mares+cadenza@gmail.com?subject=Cadenza%3A%20new%20target%20language%20request"
          >
            Request a new language
          </a>
          .
        </p>
      </div>

      <div className="hairline flex flex-col gap-3 pt-6">
        {signedIn ? (
          <>
            <span className="label-mono text-muted-foreground">{email}</span>
            <button
              type="button"
              onClick={() => void signOut()}
              className="font-button self-start rounded-full border border-border px-5 py-2.5 text-muted-foreground hover:border-brass hover:text-brass"
            >
              Sign out
            </button>
          </>
        ) : (
          <>
            <span className="label-mono text-muted-foreground">[ NOT SIGNED IN ]</span>
            <button
              type="button"
              onClick={() => onNavigate('signin')}
              className="font-button self-start rounded-full border border-brass bg-brass px-5 py-2.5 text-ink hover:bg-brass-soft"
            >
              Sign in
            </button>
          </>
        )}
      </div>
    </section>
  )
}
