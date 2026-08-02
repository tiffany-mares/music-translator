import { screen, waitFor, within } from '@testing-library/react'
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
    // Deep-link sync (urlView): pushState from earlier tests persists on the
    // shared jsdom location - start every test at the home path.
    window.history.replaceState(null, '', '/')
    mockedAuth.fetchAuthSession.mockResolvedValue(session)
    mockedApi.getDueVocab.mockResolvedValue({ items: [], count: 0 })
    mockedApi.getSongs.mockResolvedValue([])
  })

  it('defaults to Home; upload form and review panel are hidden but MOUNTED', async () => {
    renderWithProviders(<Shell />)
    // Nav queries scoped: the full marketing pages mount with the shell and
    // an unscoped role scan over that DOM is too slow under full-suite load.
    const nav = screen.getByRole('navigation', { name: 'View' })
    expect(within(nav).getByRole('button', { name: 'Home' })).toHaveAttribute('aria-pressed', 'true')
    // hidden, not unmounted — getBy* still finds them, but they are not visible
    expect(screen.getByLabelText(/audio file/i)).not.toBeVisible()
    expect(await screen.findByText(/due for review/i)).not.toBeVisible()
  }, 15000)

  it('toggles views without unmounting any panel', async () => {
    renderWithProviders(<Shell />)
    // Nav queries scoped: unscoped role scans over the mounted marketing DOM
    // are too slow in jsdom.
    const nav = within(screen.getByRole('navigation', { name: 'View' }))
    await userEvent.click(nav.getByRole('button', { name: 'Upload' }))
    expect(screen.getByLabelText(/audio file/i)).toBeVisible()
    await userEvent.click(nav.getByRole('button', { name: /^review/i }))
    expect(screen.getByText(/due for review/i)).toBeVisible()
    expect(screen.getByLabelText(/audio file/i)).not.toBeVisible()
    expect(nav.getByRole('button', { name: /^review/i })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(nav.getByRole('button', { name: 'Upload' }))
    expect(screen.getByLabelText(/audio file/i)).toBeVisible()
  }, 15000)

  it('shows the due count on the Review tab only when nonzero', async () => {
    mockedApi.getDueVocab.mockResolvedValue({
      items: [
        { vocabId: 'a', term: 'a', definition: 'x', songId: null, nextReviewAt: '2026-01-01T00:00:00Z' },
        { vocabId: 'b', term: 'b', definition: 'y', songId: null, nextReviewAt: '2026-01-02T00:00:00Z' },
      ],
      count: 2,
    })
    renderWithProviders(<Shell />)
    // Scoped to the nav: the full marketing pages now mount with the shell,
    // and an unscoped role+name scan over that DOM is too slow for findBy's
    // poll window in jsdom.
    const nav = screen.getByRole('navigation', { name: 'View' })
    expect(await within(nav).findByRole('button', { name: 'Review (2)' })).toBeInTheDocument()
  })

  it('signed out: full shell renders with a Sign in nav item; Review shows the sign-in prompt', async () => {
    mockedAuth.fetchAuthSession.mockResolvedValue({} as Session)
    renderWithProviders(<Shell />)
    const nav = within(screen.getByRole('navigation', { name: 'View' }))
    // Listen/upload surface is fully available…
    await userEvent.click(nav.getByRole('button', { name: 'Upload' }))
    expect(screen.getByLabelText(/audio file/i)).toBeVisible()
    // …and vocab never fetches without a session.
    expect(mockedApi.getDueVocab).not.toHaveBeenCalled()
    await userEvent.click(nav.getByRole('button', { name: /^review/i }))
    expect(screen.getByText(/sign in to build your vocabulary/i)).toBeVisible()
  })

  it('Sign in nav item opens the auth view', async () => {
    mockedAuth.fetchAuthSession.mockResolvedValue({} as Session)
    renderWithProviders(<Shell />)
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(screen.getByRole('form', { name: /sign in/i })).toBeVisible()
  })

  it('/signup deep link opens the auth card in sign-up mode', async () => {
    mockedAuth.fetchAuthSession.mockResolvedValue({} as Session)
    window.history.replaceState(null, '', '/signup')
    renderWithProviders(<Shell />)
    expect(screen.getByRole('form', { name: /sign up/i })).toBeVisible()
  })

  it('initializes the view from a deep-link path', async () => {
    window.history.replaceState(null, '', '/upload')
    renderWithProviders(<Shell />)
    expect(screen.getByLabelText(/audio file/i)).toBeVisible()
  })

  it('nav clicks update the URL; back restores the previous view', async () => {
    renderWithProviders(<Shell />)
    const nav = within(screen.getByRole('navigation', { name: 'View' }))
    await userEvent.click(nav.getByRole('button', { name: 'Upload' }))
    expect(window.location.pathname).toBe('/upload')
    await userEvent.click(nav.getByRole('button', { name: 'Stack' }))
    expect(window.location.pathname).toBe('/stack')
    window.history.back()
    // jsdom fires popstate asynchronously after history.back(); the views are
    // always-mounted, so wait on VISIBILITY (existence is always true).
    await waitFor(() => expect(screen.getByLabelText(/audio file/i)).toBeVisible())
    expect(window.location.pathname).toBe('/upload')
  }, 15000)
})
