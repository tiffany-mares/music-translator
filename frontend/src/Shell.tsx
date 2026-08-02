import { useCallback, useEffect, useState } from 'react'
import AuthPage from './auth/AuthPage'
import { useAuth } from './auth/AuthContext'
import LibraryView from './library/LibraryView'
import HowItWorks from './marketing/HowItWorks'
import Landing from './marketing/Landing'
import Stack from './marketing/Stack'
import NavShell, { type View } from './nav/NavShell'
import { parsePath, viewToPath } from './nav/urlView'
import UploadPanel from './upload/UploadPanel'
import ReviewPanel from './vocab/ReviewPanel'
import { useDueVocab } from './vocab/useDueVocab'
import { JobSocketProvider } from './ws/JobSocketContext'

// No router (repo convention: conditional render is the route guard). Every
// view stays MOUNTED and toggles with `hidden`: switching views must not tear
// down the upload session or stop audio playback — reviewing while the song
// keeps playing is the point of the loop. Phase 7: the shell renders for
// EVERYONE (listen/upload are public); only Review and word-saving need auth.
export default function Shell() {
  const { status, email, signOut } = useAuth()
  const signedIn = status === 'signedIn'
  // Deep links without a router: view state initializes from and mirrors to
  // the URL (urlView.ts); back/forward drive popstate -> state.
  const [route, setRoute] = useState(() => parsePath(window.location.pathname))
  const view = route.view

  const setView = useCallback((v: View, songId: string | null = null) => {
    setRoute({ view: v, songId })
    const path = viewToPath(v, songId)
    if (window.location.pathname !== path) window.history.pushState(null, '', path)
  }, [])

  useEffect(() => {
    const onPop = () => setRoute(parsePath(window.location.pathname))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const { data: due } = useDueVocab()
  const dueCount = due?.count ?? 0

  // Sign-in is a view, not a gate: once the session lands, leave the form.
  useEffect(() => {
    if (signedIn && (view === 'signin' || view === 'signup' || view === 'reset')) setView('library')
  }, [signedIn, view, setView])

  // JobSocketProvider is a no-op when signed out (it mounts the socket only
  // for signed-in sessions); anonymous visitors get job status via polling.
  return (
    <JobSocketProvider>
      <NavShell
        view={view}
        onNavigate={setView}
        dueCount={dueCount}
        signedIn={signedIn}
        email={email}
        onSignOut={() => void signOut()}
      >
        <div hidden={view !== 'home'}>
          <Landing onNavigate={setView} />
        </div>
        <div hidden={view !== 'how'}>
          <HowItWorks onNavigate={setView} />
        </div>
        <div hidden={view !== 'library'}>
          <LibraryView
            onNavigate={setView}
            selectedSongId={route.songId}
            onSelectSong={(songId) => setView('library', songId)}
          />
        </div>
        <div hidden={view !== 'upload'}>
          <UploadPanel />
        </div>
        <div hidden={view !== 'review'}>
          {signedIn ? (
            <ReviewPanel />
          ) : (
            <section className="mx-auto max-w-xl px-6 py-16">
              <p className="label-mono text-brass">[ REVIEW ]</p>
              <h1 className="font-content pt-3 text-2xl font-semibold">
                Sign in to build your vocabulary
              </h1>
              <p className="pt-3 text-muted-foreground">
                Tap words in any song to save them, then review on a spaced-repetition schedule.
              </p>
              <button
                type="button"
                className="font-button mt-6 rounded-full border border-brass bg-brass px-5 py-2.5 text-primary-foreground"
                onClick={() => setView('signin')}
              >
                Sign in
              </button>
            </section>
          )}
        </div>
        <div hidden={view !== 'stack'}>
          <Stack />
        </div>
        {/* Auth is the one full-bleed view: a fixed overlay above the nav
            shell so the watercolor painting IS the page and the glass card
            floats on it (the Lovable auth route rendered shell-less too). */}
        <div hidden={view !== 'signin' && view !== 'signup' && view !== 'reset'}>
          {!signedIn && (
            <div className="fixed inset-0 z-[60] overflow-y-auto">
              <button
                type="button"
                onClick={() => setView('home')}
                className="label-mono fixed left-5 top-5 z-[70] text-white/80 hover:text-brass"
              >
                ← Back
              </button>
              {/* key remounts the form when switching entry points so the
                  card opens in the matching mode */}
              <AuthPage
                key={view}
                initialMode={view === 'signup' ? 'signUp' : view === 'reset' ? 'reset' : 'signIn'}
                onNavigate={setView}
              />
            </div>
          )}
        </div>
      </NavShell>
    </JobSocketProvider>
  )
}
