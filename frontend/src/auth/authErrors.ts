// Amplify v6 surfaces Cognito exceptions with .name mirroring the Cognito
// exception type. The pool has user-existence-error prevention, so
// UserNotFoundException arrives as NotAuthorizedException — the wording covers both.
const MESSAGES: Record<string, string> = {
  NotAuthorizedException: 'Incorrect email or password.',
  UserNotConfirmedException: "This account isn't confirmed yet — check your email for a code.",
  UsernameExistsException: 'An account with this email already exists — sign in instead.',
  InvalidPasswordException:
    'Password must be at least 8 characters with an uppercase letter, a lowercase letter, and a number.',
  CodeMismatchException: "That code doesn't match — check the email and try again.",
  ExpiredCodeException: 'That code has expired — request a new one.',
  LimitExceededException: 'Too many attempts — wait a few minutes and try again.',
}

export function authErrorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'name' in err) {
    const known = MESSAGES[(err as { name: string }).name]
    if (known) return known
  }
  return 'Something went wrong — please try again.'
}
