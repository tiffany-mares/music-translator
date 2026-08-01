import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import ThemeToggle, { THEME_STORAGE_KEY } from './ThemeToggle'

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('light')
  })

  afterEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('light')
  })

  it('defaults to dark: no light class, offers switch to light', () => {
    render(<ThemeToggle />)
    expect(document.documentElement.classList.contains('light')).toBe(false)
    expect(screen.getByRole('button', { name: /switch to light theme/i })).toBeInTheDocument()
  })

  it('toggling applies the light class and persists the choice', async () => {
    render(<ThemeToggle />)
    await userEvent.click(screen.getByRole('button', { name: /switch to light theme/i }))
    expect(document.documentElement.classList.contains('light')).toBe(true)
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
    expect(screen.getByRole('button', { name: /switch to dark theme/i })).toBeInTheDocument()
  })

  it('toggling back to dark removes the class and persists dark', async () => {
    render(<ThemeToggle />)
    await userEvent.click(screen.getByRole('button', { name: /switch to light theme/i }))
    await userEvent.click(screen.getByRole('button', { name: /switch to dark theme/i }))
    expect(document.documentElement.classList.contains('light')).toBe(false)
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
  })

  it('reads a stored light preference on mount', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light')
    render(<ThemeToggle />)
    expect(document.documentElement.classList.contains('light')).toBe(true)
    expect(screen.getByRole('button', { name: /switch to dark theme/i })).toBeInTheDocument()
  })
})
