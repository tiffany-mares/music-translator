import { useAuth } from './auth/AuthContext'
import Shell from './Shell'

// Phase 7: the shell renders for everyone — listen/upload/library are public.
// Auth is a view inside the shell (Sign in nav item), not a gate.
export default function App() {
  const { status } = useAuth()
  if (status === 'loading') return <p className="loading">Loading…</p>
  return <Shell />
}
