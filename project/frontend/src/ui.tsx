import { useEffect } from "react";
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from "react";


let modalScrollLockCount = 0;
let savedModalScrollStyles: {
  bodyOverflow: string;
  bodyOverscrollBehavior: string;
  bodyPaddingRight: string;
  htmlOverflow: string;
  htmlOverscrollBehavior: string;
} | null = null;

/** Lock the page behind an open modal while leaving the modal's own scroll areas usable. */
export function useModalScrollLock(active = true): void {
  useEffect(() => {
    if (!active || typeof document === "undefined") return;

    const body = document.body;
    const html = document.documentElement;

    if (modalScrollLockCount === 0) {
      savedModalScrollStyles = {
        bodyOverflow: body.style.overflow,
        bodyOverscrollBehavior: body.style.overscrollBehavior,
        bodyPaddingRight: body.style.paddingRight,
        htmlOverflow: html.style.overflow,
        htmlOverscrollBehavior: html.style.overscrollBehavior,
      };

      // Compensate for the disappearing desktop scrollbar to avoid a horizontal layout shift.
      const scrollbarWidth = Math.max(0, window.innerWidth - html.clientWidth);
      if (scrollbarWidth > 0) {
        const currentPadding = Number.parseFloat(window.getComputedStyle(body).paddingRight) || 0;
        body.style.paddingRight = `${currentPadding + scrollbarWidth}px`;
      }

      body.style.overflow = "hidden";
      body.style.overscrollBehavior = "none";
      html.style.overflow = "hidden";
      html.style.overscrollBehavior = "none";
    }

    modalScrollLockCount += 1;
    let released = false;

    return () => {
      if (released) return;
      released = true;
      modalScrollLockCount = Math.max(0, modalScrollLockCount - 1);

      if (modalScrollLockCount === 0 && savedModalScrollStyles) {
        body.style.overflow = savedModalScrollStyles.bodyOverflow;
        body.style.overscrollBehavior = savedModalScrollStyles.bodyOverscrollBehavior;
        body.style.paddingRight = savedModalScrollStyles.bodyPaddingRight;
        html.style.overflow = savedModalScrollStyles.htmlOverflow;
        html.style.overscrollBehavior = savedModalScrollStyles.htmlOverscrollBehavior;
        savedModalScrollStyles = null;
      }
    };
  }, [active]);
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "chip" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({ className = "", variant = "secondary", ...props }: ButtonProps) {
  const variants: Record<ButtonVariant, string> = {
    primary: "bg-accent text-white shadow-sm hover:bg-accent-strong",
    secondary: "border border-line bg-white text-ink shadow-sm hover:bg-surface-strong",
    ghost: "text-ink-muted hover:bg-surface-strong hover:text-ink",
    chip: "border border-line bg-white text-ink-muted hover:border-accent/40 hover:text-ink",
      danger: "border border-danger bg-danger text-white shadow-sm hover:brightness-95",
  };

  return (
    <button
      className={`min-h-11 rounded-xl px-4 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45 ${variants[variant]} ${className}`}
      {...props}
    />
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
}

export function IconButton({ label, className = "", children, ...props }: IconButtonProps) {
  return (
    <button
      aria-label={label}
      className={`inline-flex size-11 items-center justify-center rounded-xl border border-line bg-white text-ink transition-colors hover:bg-surface-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-45 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function CardButton({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`block w-full text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${className}`}
      {...props}
    />
  );
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`min-h-11 rounded-xl border border-line bg-white px-3 text-sm text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/15 ${className}`}
      {...props}
    />
  );
}

interface SurfaceProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Surface({ className = "", children, ...props }: SurfaceProps) {
  return (
    <div className={`rounded-2xl border border-line bg-white shadow-card ${className}`} {...props}>
      {children}
    </div>
  );
}

export function Icon({
  name,
  className = "size-5",
}: {
  name:
    | "grid"
    | "chart"
    | "clock"
    | "minus"
    | "plus"
    | "arrow"
    | "reset"
    | "check"
    | "chevron"
    | "download"
    | "search"
    | "users"
    | "megaphone"
    | "trash"
    | "settings"
    | "sun"
    | "moon"
    | "receipt";
  className?: string;
}) {
  const paths: Record<string, ReactNode> = {
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="2" />
        <rect x="14" y="3" width="7" height="7" rx="2" />
        <rect x="3" y="14" width="7" height="7" rx="2" />
        <rect x="14" y="14" width="7" height="7" rx="2" />
      </>
    ),
    chart: (
      <>
        <path d="M4 19V9" />
        <path d="M10 19V5" />
        <path d="M16 19v-7" />
        <path d="M22 19H2" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    minus: <path d="M5 12h14" />,
    plus: (
      <>
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </>
    ),
    arrow: (
      <>
        <path d="M5 12h14" />
        <path d="m14 7 5 5-5 5" />
      </>
    ),
    reset: (
      <>
        <path d="M4 4v6h6" />
        <path d="M5.5 15a8 8 0 1 0 1-8.5L4 10" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    chevron: <path d="m8 10 4 4 4-4" />,
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </>
    ),
    users: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
    megaphone: (
      <>
        <path d="M3 11v2a2 2 0 0 0 2 2h2l10 5V4L7 9H5a2 2 0 0 0-2 2Z" />
        <path d="m7 15 2 6h4l-2-5" />
        <path d="M21 9a4 4 0 0 1 0 6" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.7 2.94-.09-.02a1.7 1.7 0 0 0-1.73.65l-.05.08h-3.4l-.05-.08a1.7 1.7 0 0 0-1.73-.65l-.09.02-1.7-2.94.06-.06A1.7 1.7 0 0 0 9.6 15l-.09-.03v-3.4l.09-.03a1.7 1.7 0 0 0-.34-1.88l-.06-.06 1.7-2.94.09.02a1.7 1.7 0 0 0 1.73-.65l.05-.08h3.4l.05.08a1.7 1.7 0 0 0 1.73.65l.09-.02 1.7 2.94-.06.06A1.7 1.7 0 0 0 19.4 11.5l.09.03v3.4z" transform="translate(-2 -2) scale(1.16)" />
      </>
    ),
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
      </>
    ),
    moon: <path d="M20.4 15.2A8.5 8.5 0 0 1 8.8 3.6 8.5 8.5 0 1 0 20.4 15.2Z" />,
    receipt: (
      <>
        <path d="M5 3.5h14v17l-3.5-2-3.5 2-3.5-2L5 20.5v-17Z" />
        <path d="M8.5 8h7M8.5 12h7M8.5 16h4.5" />
      </>
    ),
    trash: (
      <>
        <path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6" />
        <path d="M10 11v5M14 11v5" />
      </>
    ),
    download: (
      <>
        <path d="M4 3h10l4 4v5" />
        <path d="M14 3v5h5" />
        <path d="M5 13v7h14v-7" />
        <path d="M9 13h6M9 17h6" />
        <path d="M12 6v7m0 0 3-3m-3 3-3-3" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}
