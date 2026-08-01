import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import HowItWorks from './HowItWorks'
import Landing from './Landing'
import Stack from './Stack'

// Smoke tests for the ported Lovable marketing pages. jsdom has no
// IntersectionObserver — useScrollReveal must no-op gracefully (guarded),
// so nothing here stubs it.

describe('Landing', () => {
  it('renders the hero headline', () => {
    render(<Landing onNavigate={vi.fn()} />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/cadenza/i)
    expect(screen.getByText(/splits the vocal\./i)).toBeInTheDocument()
  })

  it('hero CTAs navigate to library, upload, and how', () => {
    const onNavigate = vi.fn()
    render(<Landing onNavigate={onNavigate} />)

    fireEvent.click(screen.getAllByRole('button', { name: /browse library/i })[0])
    expect(onNavigate).toHaveBeenLastCalledWith('library')

    fireEvent.click(screen.getAllByRole('button', { name: /upload a song/i })[0])
    expect(onNavigate).toHaveBeenLastCalledWith('upload')

    fireEvent.click(screen.getByRole('button', { name: /how it works/i }))
    expect(onNavigate).toHaveBeenLastCalledWith('how')
  })

  it('flow rows navigate to their views', () => {
    const onNavigate = vi.fn()
    render(<Landing onNavigate={onNavigate} />)

    fireEvent.click(screen.getByRole('button', { name: /come back and review/i }))
    expect(onNavigate).toHaveBeenLastCalledWith('review')

    fireEvent.click(screen.getByRole('button', { name: /under the hood/i }))
    expect(onNavigate).toHaveBeenLastCalledWith('stack')
  })
})

describe('HowItWorks', () => {
  it('renders its heading', () => {
    render(<HowItWorks />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/how to use cadenza/i)
  })

  it('CTAs call onNavigate when provided', () => {
    const onNavigate = vi.fn()
    render(<HowItWorks onNavigate={onNavigate} />)

    fireEvent.click(screen.getAllByRole('button', { name: /upload a song/i })[0])
    expect(onNavigate).toHaveBeenLastCalledWith('upload')

    fireEvent.click(screen.getByRole('button', { name: /start reviewing/i }))
    expect(onNavigate).toHaveBeenLastCalledWith('review')
  })
})

describe('Stack', () => {
  it('renders its heading and real technology names', () => {
    render(<Stack />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      /no server sits around waiting/i,
    )
    expect(screen.getAllByText(/Demucs/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Step Functions/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Terraform/).length).toBeGreaterThan(0)
  })
})
