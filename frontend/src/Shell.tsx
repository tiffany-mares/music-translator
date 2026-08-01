import { useState } from 'react'
import { useAuth } from './auth/AuthContext'
import UploadPanel from './upload/UploadPanel'
import ReviewPanel from './vocab/ReviewPanel'
import { useDueVocab } from './vocab/useDueVocab'
import { JobSocketProvider } from './ws/JobSocketContext'

type View = 'listen' | 'review'

// No router (repo convention: conditional render is the route guard). Both
// views stay MOUNTED and toggle with `hidden`: switching to Review must not
// tear down the upload session or stop audio playback — reviewing while the
// song keeps playing is the point of the loop.
export default function Shell() {
  const { email, signOut } = useAuth()
  const [view, setView] = useState<View>('listen')
  const { data: due } = useDueVocab()
  const dueCount = due?.count ?? 0
  // JobSocketProvider sits under main.tsx's QueryClientProvider+AuthProvider
  // and above both always-mounted views; mounting it here scopes the WS to the
  // signed-in session (App unmounts Shell on sign-out = socket teardown).
  return (
    <JobSocketProvider>
    <div className="shell">
      <header className="shell-header">
        <span className="wordmark">Cadenza</span>
        <nav className="shell-nav" aria-label="View">
          <button aria-pressed={view === 'listen'} onClick={() => setView('listen')}>
            Listen
          </button>
          <button aria-pressed={view === 'review'} onClick={() => setView('review')}>
            Review{dueCount > 0 ? ` (${dueCount})` : ''}
          </button>
        </nav>
        <div className="shell-user">
          <span>{email}</span>
          <button onClick={() => void signOut()}>Sign out</button>
        </div>
      </header>
      <main className="shell-main">
        <div hidden={view !== 'listen'}>
          <UploadPanel />
        </div>
        <div hidden={view !== 'review'}>
          <ReviewPanel />
        </div>
      </main>
    </div>
    </JobSocketProvider>
  )
}
