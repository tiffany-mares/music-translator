import AuthPage from './auth/AuthPage'
import { useAuth } from './auth/AuthContext'
import Shell from './Shell'

export default function App() {
  const { status } = useAuth()
  if (status === 'loading') return <p className="loading">Loading…</p>
  return status === 'signedIn' ? <Shell /> : <AuthPage />
}
