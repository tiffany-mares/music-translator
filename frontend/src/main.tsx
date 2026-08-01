// amplifyConfig MUST stay the first import: ES module evaluation order is the
// only thing guaranteeing Amplify.configure runs before aws-amplify/auth is used.
import './amplifyConfig'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
// Transition state (lovable-reskin): index.css holds the legacy component
// classes until every screen is re-skinned (deleted in the final task);
// styles.css is the Cadenza theme and must import AFTER it so shared
// globals resolve to the new theme.
import './index.css'
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
