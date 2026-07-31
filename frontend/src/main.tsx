// amplifyConfig MUST stay the first import: ES module evaluation order is the
// only thing guaranteeing Amplify.configure runs before aws-amplify/auth is used.
import './amplifyConfig'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './auth/AuthContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
)
