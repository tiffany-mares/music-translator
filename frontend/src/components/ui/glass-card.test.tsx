import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  GlassCard,
  GlassCardAction,
  GlassCardContent,
  GlassCardDescription,
  GlassCardFooter,
  GlassCardHeader,
  GlassCardTitle,
} from './glass-card'

describe('GlassCard', () => {
  it('composes all slots with their data-slot attributes and merges classes', () => {
    render(
      <GlassCard className="custom-class" data-testid="card">
        <GlassCardHeader>
          <GlassCardTitle>Title</GlassCardTitle>
          <GlassCardDescription>Description</GlassCardDescription>
          <GlassCardAction>Action</GlassCardAction>
        </GlassCardHeader>
        <GlassCardContent>Content</GlassCardContent>
        <GlassCardFooter>Footer</GlassCardFooter>
      </GlassCard>,
    )
    const card = screen.getByTestId('card')
    expect(card).toHaveAttribute('data-slot', 'glass-card')
    expect(card.className).toContain('backdrop-blur-md')
    expect(card.className).toContain('custom-class')
    for (const slot of ['header', 'title', 'description', 'action', 'content', 'footer']) {
      expect(document.querySelector(`[data-slot="glass-card-${slot}"]`)).toBeInTheDocument()
    }
  })
})
