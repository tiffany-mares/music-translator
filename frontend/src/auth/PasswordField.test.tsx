import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import PasswordField from './PasswordField'

describe('PasswordField', () => {
  it('starts hidden with a Show password toggle', () => {
    render(<PasswordField value="hunter2secret" onChange={vi.fn()} autoComplete="current-password" />)
    expect(screen.getByLabelText(/password/i, { selector: 'input' })).toHaveAttribute('type', 'password')
    expect(screen.getByRole('button', { name: /show password/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('toggling reveals the value and flips to Hide password', async () => {
    render(<PasswordField value="hunter2secret" onChange={vi.fn()} autoComplete="new-password" />)
    await userEvent.click(screen.getByRole('button', { name: /show password/i }))
    expect(screen.getByLabelText(/password/i, { selector: 'input' })).toHaveAttribute('type', 'text')
    const hide = screen.getByRole('button', { name: /hide password/i })
    expect(hide).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(hide)
    expect(screen.getByLabelText(/password/i, { selector: 'input' })).toHaveAttribute('type', 'password')
  })

  it('shows the eight-dot placeholder before the user types', () => {
    render(<PasswordField value="" onChange={vi.fn()} autoComplete="current-password" />)
    expect(screen.getByLabelText(/password/i, { selector: 'input' })).toHaveAttribute(
      'placeholder',
      '••••••••',
    )
  })

  it('typing still reaches onChange and the toggle never submits the form', async () => {
    const onChange = vi.fn()
    const onSubmit = vi.fn((e: { preventDefault(): void }) => e.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <PasswordField value="" onChange={onChange} autoComplete="current-password" />
      </form>,
    )
    await userEvent.type(screen.getByLabelText(/password/i, { selector: 'input' }), 'a')
    expect(onChange).toHaveBeenCalledWith('a')
    await userEvent.click(screen.getByRole('button', { name: /show password/i }))
    expect(onSubmit).not.toHaveBeenCalled()
  })
})