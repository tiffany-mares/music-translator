import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'

export const THEME_STORAGE_KEY = 'cadenza-theme'

type Theme = 'dark' | 'light'

function storedTheme(): Theme {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

// The app defaults DARK (:root in styles.css is the dark palette); .light on
// <html> opts into the warm-paper palette. Same storage key as the Lovable
// design so a previously-toggled preference carries over.
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(storedTheme)

  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light')
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch {
      /* private mode: theme just won't persist */
    }
  }, [theme])

  const next: Theme = theme === 'light' ? 'dark' : 'light'
  return (
    <button
      type="button"
      className="label-mono flex items-center gap-2 text-muted-foreground"
      aria-label={`Switch to ${next} theme`}
      onClick={() => setTheme(next)}
    >
      {theme === 'light' ? <Moon size={14} aria-hidden /> : <Sun size={14} aria-hidden />}
      {theme === 'light' ? 'Dark' : 'Light'}
    </button>
  )
}
