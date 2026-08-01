import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

// Password input with a show/hide toggle (Cadenza-styled, used by the sign-in
// and sign-up forms). Keeps the label-wraps-input association the auth tests
// rely on (getByLabelText(/password/i)); the toggle is type="button" so it can
// never submit the surrounding form.
export default function PasswordField({
  value,
  onChange,
  autoComplete,
  label = 'Password',
}: {
  value: string
  onChange: (value: string) => void
  autoComplete: 'current-password' | 'new-password'
  label?: string
}) {
  const [visible, setVisible] = useState(false)

  return (
    <label className="label-mono flex flex-col gap-1.5 text-muted-foreground">
      {label}
      <span className="relative block">
        <input
          className="w-full rounded-[3px] border border-border bg-surface px-4 py-3 pr-11 text-sm text-foreground outline-none focus:border-brass"
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
          autoComplete={autoComplete}
        />
        <button
          type="button"
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-brass"
        >
          {visible ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
        </button>
      </span>
    </label>
  )
}
