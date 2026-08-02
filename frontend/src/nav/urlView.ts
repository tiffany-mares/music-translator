import type { View } from './NavShell'

// Deep links without a router (Phase 7 follow-up): the Shell's view state is
// mirrored to real paths via pushState/popstate. CloudFront's SPA 403->index
// fallback (4.1) makes every path refreshable. Adopt a real router only if
// nested/parameterized routing outgrows this.

const VIEW_PATHS: Record<View, string> = {
  home: '/',
  how: '/how-it-works',
  library: '/library',
  upload: '/upload',
  review: '/review',
  stack: '/stack',
  signin: '/signin',
  signup: '/signup',
  reset: '/reset-password',
  profile: '/profile',
}

const PATH_VIEWS = Object.fromEntries(
  Object.entries(VIEW_PATHS).map(([view, path]) => [path, view as View]),
)

export function viewToPath(view: View, songId: string | null = null): string {
  if (view === 'library' && songId) return `/song/${songId}`
  return VIEW_PATHS[view]
}

export function parsePath(pathname: string): { view: View; songId: string | null } {
  const song = /^\/song\/([A-Za-z0-9-]+)\/?$/.exec(pathname)
  if (song) return { view: 'library', songId: song[1] }
  const normalized = pathname !== '/' && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  return { view: PATH_VIEWS[normalized] ?? 'home', songId: null }
}
