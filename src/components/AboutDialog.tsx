import { useEffect, useRef } from "react";

interface Props {
  version: string;
  onClose: () => void;
}

export function AboutDialog({ version, onClose }: Props) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="about-dialog-backdrop" onPointerDown={onClose}>
      <section
        className="about-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="About MaCa Editor"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <h2>MaCa Editor</h2>
        <dl>
          <div>
            <dt>Version</dt>
            <dd>{version}</dd>
          </div>
          <div>
            <dt>Author</dt>
            <dd>mikoto2000 &lt;mikoto2000@gmail.com&gt;</dd>
          </div>
        </dl>
        <div className="about-dialog-actions">
          <button ref={closeButtonRef} type="button" onClick={onClose}>OK</button>
        </div>
      </section>
    </div>
  );
}
