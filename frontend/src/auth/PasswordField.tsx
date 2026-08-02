import { useId, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// Password input with a show/hide toggle, built on the shared shadcn-style
// Input/Label. The toggle is type="button" so it can never submit the
// surrounding form; its aria-label ("Show password") also matches
// getByLabelText(/password/i), which is why tests scope field queries with
// selector: 'input'.
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
  const id = useId()

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <span className="relative block">
        <Input
          id={id}
          className="pr-11"
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
          {visible ? (
            <EyeOff className="h-4 w-4" aria-hidden />
          ) : (
            <Eye className="h-4 w-4" aria-hidden />
          )}
        </button>
      </span>
    </div>
  )
}
