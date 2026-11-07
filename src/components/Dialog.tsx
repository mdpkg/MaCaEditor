import { useId, useRef, type ReactNode, type RefObject } from "react";
import { useDialog } from "../lib/focus";

interface Props {
  title: ReactNode;
  className?: string;
  onClose: () => void;
  initialFocus?: RefObject<HTMLElement>;
  children: ReactNode;
  backdrop?: boolean;
}

export function Dialog({ title, className = "about-dialog", onClose, initialFocus, children, backdrop = true }: Props) {
  const ref = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialog(ref, onClose, backdrop ? backdropRef : ref, initialFocus);
  const content = (
    <section ref={ref} className={className} role="dialog" aria-modal="true"
      aria-labelledby={titleId} tabIndex={-1}>
      <h2 id={titleId}>{title}</h2>
      {children}
    </section>
  );
  return backdrop ? (
    <div ref={backdropRef} className="about-dialog-backdrop" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>{content}</div>
  ) : content;
}
