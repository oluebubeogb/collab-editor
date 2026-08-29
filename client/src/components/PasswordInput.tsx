import { useState } from 'react'

interface PasswordInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  autoComplete?: string
  className?: string
  style?: React.CSSProperties
  autoFocus?: boolean
  id?: string
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
}

/** Theme-aware password field with show/hide eye toggle. */
export default function PasswordInput({
  value,
  onChange,
  placeholder = 'Password',
  autoComplete,
  className = '',
  style,
  autoFocus,
  id,
  onKeyDown
}: PasswordInputProps) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        id={id}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        onKeyDown={onKeyDown}
        className={`w-full rounded-lg border py-2.5 pl-3 pr-10 text-sm outline-none transition-colors focus:border-[var(--accent)] ${className}`}
        style={{
          background: 'var(--surface-2)',
          borderColor: 'var(--line)',
          color: 'var(--ink)',
          ...style
        }}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={show ? 'Hide password' : 'Show password'}
        onClick={() => setShow((v) => !v)}
        className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-[var(--surface-3)] hover:text-ink-muted"
      >
        <i className={`fa-solid ${show ? 'fa-eye-slash' : 'fa-eye'} text-[13px]`} />
      </button>
    </div>
  )
}
