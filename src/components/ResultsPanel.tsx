import { useEffect, useId, useRef, type ReactNode } from "react";

/** Non-modal results stay open while the source editor is used. */
export function ResultsPanel({ title, className, onClose, children }: {
  title: string; className: string; onClose: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input, select, button")?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  return <section ref={ref} className={`about-dialog results-panel ${className}`} role="region" aria-labelledby={titleId}
    onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
    }}>
    <h2 id={titleId}>{title}</h2>
    {children}
  </section>;
}
