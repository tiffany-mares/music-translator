import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import NoteDrift from './NoteDrift'

describe('NoteDrift', () => {
  it('renders a decorative canvas and survives jsdom (no 2d context)', () => {
    const { container } = render(<NoteDrift />)
    const canvas = container.querySelector('canvas')
    expect(canvas).toBeInTheDocument()
    expect(canvas).toHaveAttribute('aria-hidden')
    expect(canvas!.className).toContain('pointer-events-none')
  })
})
