import { useEffect, useRef } from "react";

interface Props {
  text: string;
  onClose: () => void;
}

export function ThirdPartyLicensesDialog({ text, onClose }: Props) {
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
        className="about-dialog third-party-licenses-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Third party licenses"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <h2>Third party licenses</h2>
        <pre tabIndex={0}>{text}</pre>
        <div className="about-dialog-actions">
          <button ref={closeButtonRef} type="button" onClick={onClose}>Close</button>
        </div>
      </section>
    </div>
  );
}
