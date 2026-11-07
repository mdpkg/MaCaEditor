import { uiText } from "../lib/uiText";
import { Dialog } from "./Dialog";
import { useRef } from "react";

interface Props {
  text: string;
  onClose: () => void;
}

export function ThirdPartyLicensesDialog({ text, onClose }: Props) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog className="about-dialog third-party-licenses-dialog" onClose={onClose} title={uiText("Third party licenses")} initialFocus={closeButtonRef}>
      <pre tabIndex={0}>{text}</pre>
      <div className="about-dialog-actions">
        <button ref={closeButtonRef} type="button" onClick={onClose}>{uiText("Close")}</button>
      </div>
    </Dialog>
  );
}
