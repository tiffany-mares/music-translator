import { describe, expect, it } from 'vitest'
import { authErrorMessage } from './authErrors'

describe('authErrorMessage', () => {
  it.each([
    ['NotAuthorizedException', 'Incorrect email or password.'],
    ['UserNotConfirmedException', "This account isn't confirmed yet — check your email for a code."],
    ['UsernameExistsException', 'An account with this email already exists — sign in instead.'],
    [
      'InvalidPasswordException',
      'Password must be at least 12 characters with an uppercase letter, a lowercase letter, and a number.',
    ],
    ['CodeMismatchException', "That code doesn't match — check the email and try again."],
    ['ExpiredCodeException', 'That code has expired — request a new one.'],
    ['LimitExceededException', 'Too many attempts — wait a few minutes and try again.'],
  ])('maps %s', (name, message) => {
    expect(authErrorMessage({ name })).toBe(message)
  })

  it('falls back for unknown errors', () => {
    expect(authErrorMessage(new Error('boom'))).toBe('Something went wrong — please try again.')
    expect(authErrorMessage(undefined)).toBe('Something went wrong — please try again.')
  })
})
