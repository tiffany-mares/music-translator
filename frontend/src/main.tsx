// amplifyConfig MUST stay the first import: ES module evaluation order is the
// only thing guaranteeing Amplify.configure runs before aws-amplify/auth is used.
import './amplifyConfig'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './styles.css'
import App from './App.tsx'
import { AuthProvider } from './auth/AuthContext'

// refetchOnWindowFocus off globally: a focus refetch would fight the job-polling
// backoff schedule, and nothing in the app wants focus refetch yet.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
