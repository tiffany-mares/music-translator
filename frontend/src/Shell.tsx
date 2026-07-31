import { useAuth } from './auth/AuthContext'
import UploadPanel from './upload/UploadPanel'

export default function Shell() {
  const { email, signOut } = useAuth()
  return (
    <div className="shell">
      <header className="shell-header">
        <span className="wordmark">Cadenza</span>
        <div className="shell-user">
          <span>{email}</span>
          <button onClick={() => void signOut()}>Sign out</button>
        </div>
      </header>
      <main className="shell-main">
        <UploadPanel />
      </main>
    </div>
  )
}
