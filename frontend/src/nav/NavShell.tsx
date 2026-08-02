import { useState, type ReactNode } from 'react'
import { Menu, X } from 'lucide-react'
import logoUrl from '../assets/cadenza-logo.png'
import ThemeToggle from '../theme/ThemeToggle'

// lucide-react 1.x dropped brand icons (the Lovable export used 0.x) -
// GitHub/LinkedIn are inlined from simple-icons paths instead.
function GithubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  )
}

function LinkedinIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  )
}

export type View = 'home' | 'how' | 'library' | 'upload' | 'review' | 'stack' | 'signin' | 'signup' | 'reset' | 'profile'

interface NavShellProps {
  view: View
  onNavigate: (view: View) => void
  dueCount: number
  /** Auth views swap the sidebar for a horizontal top bar (the painting is
      the page there; a fixed left rail would fight the full-bleed layout). */
  topBar?: boolean
  children: ReactNode
}

// Ported from the Lovable nav-bar/app-shell pair, adapted to the repo's
// no-router convention: nav entries are aria-pressed BUTTONS switching
// mounted-hidden views, not links. Desktop: fixed left sidebar (body gets
// padding-left in styles.css); mobile: fixed top bar + slide-in drawer.
export default function NavShell({
  view,
  onNavigate,
  dueCount,
  topBar = false,
  children,
}: NavShellProps) {
  const [open, setOpen] = useState(false)

  const go = (v: View) => {
    onNavigate(v)
    setOpen(false)
  }

  // Landing-section anchors (Lovable nav parity): switch to Home, then scroll
  // once the view is unhidden (double-rAF lets the hidden toggle paint first).
  const goToSection = (id: string) => {
    go('home')
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      ),
    )
  }

  if (topBar) {
    return (
      <>
        <header className="grain-dark fixed inset-x-0 top-0 z-[70] flex h-14 items-center gap-4 border-b border-border/60 bg-ink px-4 text-ink-foreground">
          <Brand onClick={() => go('home')} />
          <nav
            aria-label="View"
            className="flex flex-1 items-center gap-1 overflow-x-auto whitespace-nowrap"
          >
            <NavButton label="Home" active={view === 'home'} onClick={() => go('home')} />
            <NavButton label="Inspiration" active={false} onClick={() => goToSection('inspiration')} />
            <NavButton label="Pipeline" active={false} onClick={() => goToSection('pipeline')} />
            <NavButton label="How it works" active={view === 'how'} onClick={() => go('how')} />
            <NavButton label="Library" active={view === 'library'} onClick={() => go('library')} />
            <NavButton label="Upload" active={view === 'upload'} onClick={() => go('upload')} />
            <NavButton
              label={dueCount > 0 ? `Review (${dueCount})` : 'Review'}
              active={view === 'review'}
              onClick={() => go('review')}
            />
            <NavButton label="Stack" active={view === 'stack'} onClick={() => go('stack')} />
            <NavButton label="Profile" active={view === 'profile'} onClick={() => go('profile')} />
          </nav>
          <ThemeToggle />
        </header>
        <main className="min-h-screen paper field-grid">{children}</main>
      </>
    )
  }

  return (
    <>
      {/* mobile top bar */}
      <header className="grain-dark fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-border/60 bg-ink px-4 text-ink-foreground lg:hidden">
        <Brand onClick={() => go('home')} />
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? 'Close navigation' : 'Open navigation'}
            className="text-ink-foreground/70 transition-colors hover:text-brass"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </header>

      {open ? (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-ink/60 backdrop-blur-sm lg:hidden"
        />
      ) : null}

      {/* vertical sidebar */}
      <aside
        className={`grain-dark fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-border/60 bg-ink text-ink-foreground shadow-[18px_0_40px_-34px_rgb(0_0_0/0.8)] transition-transform duration-300 lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="relative z-10 flex items-center justify-between px-5 py-3">
          <Brand onClick={() => go('home')} />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close navigation"
            className="text-ink-foreground/60 transition-colors hover:text-brass lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav
          aria-label="View"
          className="relative z-10 flex flex-1 flex-col gap-0.5 overflow-y-auto px-3"
        >
          <p className="label-mono px-2 pb-1 text-ink-foreground/40">[ NAVIGATE ]</p>
          <NavButton label="Home" active={view === 'home'} onClick={() => go('home')} />
          <NavButton label="Inspiration" active={false} onClick={() => goToSection('inspiration')} />
          <NavButton label="Pipeline" active={false} onClick={() => goToSection('pipeline')} />
          <NavButton label="How it works" active={view === 'how'} onClick={() => go('how')} />
          <NavButton label="Library" active={view === 'library'} onClick={() => go('library')} />
          <NavButton label="Upload" active={view === 'upload'} onClick={() => go('upload')} />
          <NavButton
            label={dueCount > 0 ? `Review (${dueCount})` : 'Review'}
            active={view === 'review'}
            onClick={() => go('review')}
          />
          <NavButton label="Stack" active={view === 'stack'} onClick={() => go('stack')} />

          <span className="my-2 h-px w-full bg-border/60" />

          <p className="label-mono px-2 pb-1 text-ink-foreground/40">[ ELSEWHERE ]</p>
          <div className="flex items-center gap-1 px-1">
            <a
              href="https://tiffanymares.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-button rounded-md px-2 py-1.5 text-ink-foreground/60 transition-colors hover:bg-ink-foreground/5 hover:text-brass"
            >
              Contact
            </a>
            <a
              href="https://github.com/tiffany-mares/music-translator/tree/main"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub"
              title="GitHub"
              className="rounded-md p-1.5 text-ink-foreground/60 transition-colors hover:bg-ink-foreground/5 hover:text-brass"
            >
              <GithubIcon className="h-4 w-4" />
            </a>
            <a
              href="https://www.linkedin.com/in/tiffanymares/"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="LinkedIn"
              title="LinkedIn"
              className="rounded-md p-1.5 text-ink-foreground/60 transition-colors hover:bg-ink-foreground/5 hover:text-brass"
            >
              <LinkedinIcon className="h-4 w-4" />
            </a>
          </div>
        </nav>

        <div className="relative z-10 border-t border-border/60 px-3 py-3">
          {/* sign in/out live on the Profile page now */}
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <NavButton label="Profile" active={view === 'profile'} onClick={() => go('profile')} />
            </div>
            <span className="hidden lg:block">
              <ThemeToggle />
            </span>
          </div>
        </div>
      </aside>

      <main className="min-h-screen paper field-grid">{children}</main>
    </>
  )
}

function Brand({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group flex items-center gap-2.5">
      <img
        src={logoUrl}
        alt="Cadenza"
        width={28}
        height={28}
        className="h-7 w-7 transition-transform duration-700 group-hover:rotate-180"
      />
      <span className="font-ui-sans text-[15px] font-medium tracking-tight">cadenza</span>
    </button>
  )
}

function NavButton({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`font-button relative flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:bg-brass before:transition-transform before:duration-300 hover:bg-ink-foreground/5 hover:text-ink-foreground ${
        active
          ? 'bg-ink-foreground/5 text-brass before:scale-y-100'
          : 'text-ink-foreground/60 before:scale-y-0'
      }`}
    >
      {label}
    </button>
  )
}
