import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as amplifyAuth from 'aws-amplify/auth'
import * as api from './api/client'
import Shell from './Shell'
import { renderWithProviders } from './test/renderWithProviders'

vi.mock('aws-amplify/auth')
vi.mock('./api/client')
const mockedAuth = vi.mocked(amplifyAuth)
const mockedApi = vi.mocked(api)

type Session = Awaited<ReturnType<typeof amplifyAuth.fetchAuthSession>>
const session = {
  tokens: { idToken: { toString: () => 'tok', payload: { email: 'x@y.com' } } },
} as unknown as Session

describe('Shell navigation (5.5)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedAuth.fetchAuthSession.mockResolvedValue(session)
    mockedApi.getDueVocab.mockResolvedValue({ items: [], count: 0 })
  })

  it('defaults to Listen: upload form visible, review panel hidden but mounted', async () => {
    renderWithProviders(<Shell />)
    expect(screen.getByLabelText(/audio file/i)).toBeVisible()
    // hidden, not unmounted — getByText still finds it, but it is not visible
    expect(await screen.findByText(/due for review/i)).not.toBeVisible()
  })

  it('toggles views without unmounting either panel', async () => {
    renderWithProviders(<Shell />)
    await userEvent.click(screen.getByRole('button', { name: /^review/i }))
    expect(screen.getByText(/due for review/i)).toBeVisible()
    expect(screen.getByLabelText(/audio file/i)).not.toBeVisible()
    expect(screen.getByRole('button', { name: /^review/i })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Listen' }))
    expect(screen.getByLabelText(/audio file/i)).toBeVisible()
  })

  it('shows the due count on the Review tab only when nonzero', async () => {
    mockedApi.getDueVocab.mockResolvedValue({
      items: [
        { vocabId: 'a', term: 'a', definition: 'x', songId: null, nextReviewAt: '2026-01-01T00:00:00Z' },
        { vocabId: 'b', term: 'b', definition: 'y', songId: null, nextReviewAt: '2026-01-02T00:00:00Z' },
      ],
      count: 2,
    })
    renderWithProviders(<Shell />)
    expect(await screen.findByRole('button', { name: 'Review (2)' })).toBeInTheDocument()
  })
})
