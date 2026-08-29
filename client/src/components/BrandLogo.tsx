import { Link } from 'react-router-dom'

interface BrandLogoProps {
  to?: string
  compact?: boolean
  className?: string
}

/**
 * Brand wordmark matching the marketing mark:
 * </CollabEditor> — purple brackets, white "Collab", muted "Editor"
 */
export default function BrandLogo({ to = '/', compact = false, className = '' }: BrandLogoProps) {
  const inner = (
    <span
      className={`inline-flex items-baseline font-mono font-semibold tracking-tight select-none ${
        compact ? 'text-sm' : 'text-[15px]'
      } ${className}`}
    >
      <span className="text-brand">{'</'}</span>
      <span className="text-ink">Collab</span>
      <span className="text-ink-soft font-medium">Editor</span>
      <span className="text-brand">{'>'}</span>
    </span>
  )
  if (to) {
    return (
      <Link to={to} className="shrink-0 transition-opacity hover:opacity-90">
        {inner}
      </Link>
    )
  }
  return inner
}
