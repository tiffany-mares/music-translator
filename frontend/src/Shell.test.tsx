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

describe('Shell navigation (7: NavShell)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedAuth.fetchAuthSession.mockResolvedValue(session)
    mockedApi.getDueVocab.mockResolvedValue({ items: [], count: 0 })
    mockedApi.getSongs.mockResolvedValue([])
  })

  it('defaults to Home; upload form and review panel are hidden but MOUNTED', async () => {
    renderWithProviders(<Shell />)
    expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-pressed', 'true')
    // hidden, not unmounted — getBy* still finds them, but they are not visible
    expect(screen.getByLabelText(/audio file/i)).not.toBeVisible()
    expect(await screen.findByText(/due for review/i)).not.toBeVisible()
  })

  it('toggles views without unmounting any panel', async () => {
    renderWithProviders(<Shell />)
    await userEvent.click(screen.getByRole('button', { name: 'Upload' }))
    expect(screen.getByLabelText(/audio file/i)).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: /^review/i }))
    expect(screen.getByText(/due for review/i)).toBeVisible()
    expect(screen.getByLabelText(/audio file/i)).not.toBeVisible()
    expect(screen.getByRole('button', { name: /^review/i })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Upload' }))
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

  it('signed out: full shell renders with a Sign in nav item; Review shows the sign-in prompt', async () => {
    mockedAuth.fetchAuthSession.mockResolvedValue({} as Session)
    renderWithProviders(<Shell />)
    // Listen/upload surface is fully available…
    await userEvent.click(screen.getByRole('button', { name: 'Upload' }))
    expect(screen.getByLabelText(/audio file/i)).toBeVisible()
    // …and vocab never fetches without a session.
    expect(mockedApi.getDueVocab).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /^review/i }))
    expect(screen.getByText(/sign in to build your vocabulary/i)).toBeVisible()
  })

  it('Sign in nav item opens the auth view', async () => {
    mockedAuth.fetchAuthSession.mockResolvedValue({} as Session)
    renderWithProviders(<Shell />)
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(screen.getByRole('form', { name: /sign in/i })).toBeVisible()
  })
})
