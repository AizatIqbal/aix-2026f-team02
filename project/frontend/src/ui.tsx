import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'chip'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
}

export function Button({ className = '', variant = 'secondary', ...props }: ButtonProps) {
  const variants: Record<ButtonVariant, string> = {
    primary: 'bg-accent text-white shadow-sm hover:bg-accent-strong',
    secondary: 'border border-line bg-white text-ink shadow-sm hover:bg-surface-strong',
    ghost: 'text-ink-muted hover:bg-surface-strong hover:text-ink',
    chip: 'border border-line bg-white text-ink-muted hover:border-accent/40 hover:text-ink',
  }

  return (
    <button
      className={`min-h-11 rounded-xl px-4 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45 ${variants[variant]} ${className}`}
      {...props}
    />
  )
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  children: ReactNode
}

export function IconButton({ label, className = '', children, ...props }: IconButtonProps) {
  return (
    <button
      aria-label={label}
      className={`inline-flex size-11 items-center justify-center rounded-xl border border-line bg-white text-ink transition-colors hover:bg-surface-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-45 ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

export function CardButton({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`block w-full text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${className}`}
      {...props}
    />
  )
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`min-h-11 rounded-xl border border-line bg-white px-3 text-sm text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/15 ${className}`}
      {...props}
    />
  )
}

interface SurfaceProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

export function Surface({ className = '', children, ...props }: SurfaceProps) {
  return (
    <div className={`rounded-2xl border border-line bg-white shadow-card ${className}`} {...props}>
      {children}
    </div>
  )
}

export function Icon({
  name,
  className = 'size-5',
}: {
  name: 'grid' | 'chart' | 'clock' | 'minus' | 'plus' | 'arrow' | 'reset' | 'check' | 'chevron'
  className?: string
}) {
  const paths: Record<string, ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>,
    chart: <><path d="M4 19V9" /><path d="M10 19V5" /><path d="M16 19v-7" /><path d="M22 19H2" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    minus: <path d="M5 12h14" />,
    plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
    arrow: <><path d="M5 12h14" /><path d="m14 7 5 5-5 5" /></>,
    reset: <><path d="M4 4v6h6" /><path d="M5.5 15a8 8 0 1 0 1-8.5L4 10" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    chevron: <path d="m8 10 4 4 4-4" />,
  }

  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  )
}
