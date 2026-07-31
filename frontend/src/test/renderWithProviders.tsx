import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement, ReactNode } from 'react'
import { AuthProvider } from '../auth/AuthContext'

export function createTestClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

export function providersWrapper() {
  const client = createTestClient()
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <AuthProvider>{children}</AuthProvider>
      </QueryClientProvider>
    )
  }
}

export function renderWithProviders(ui: ReactElement) {
  return render(ui, { wrapper: providersWrapper() })
}
