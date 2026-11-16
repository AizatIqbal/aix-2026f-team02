import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Renders its children only once the section scrolls near the viewport.
 *
 * Until then it shows a placeholder of roughly the same height, so the page
 * length and scroll position do not jump when the real content appears.
 * Once shown, the content stays mounted.
 */
export function LazySection({
  minHeight,
  className = "",
  children,
}: {
  /** Height reserved for the placeholder, in pixels. */
  minHeight: number;
  className?: string;
  children: ReactNode;
}) {
  const placeholder = useRef<HTMLDivElement>(null);
  // Browsers without IntersectionObserver simply render everything at once.
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    const element = placeholder.current;
    if (visible || !element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
      },
      // Start a little before the section is on screen, so it is ready on arrival.
      { rootMargin: "300px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);

  if (visible) return <div className={className}>{children}</div>;

  return (
    <div
      ref={placeholder}
      aria-hidden="true"
      className={`animate-pulse rounded-2xl bg-surface-strong ${className}`}
      style={{ minHeight }}
    />
  );
}
