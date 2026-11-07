import { uiText } from "../lib/uiText";
import { Dialog } from "./Dialog";
import { useRef } from "react";

interface Props {
  version: string;
  onClose: () => void;
}

export function AboutDialog({ version, onClose }: Props) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog onClose={onClose} title="MaCa Editor" initialFocus={closeButtonRef}>
      <dl>
        <div>
          <dt>{uiText("Version")}</dt>
          <dd>{version}</dd>
        </div>
        <div>
          <dt>{uiText("Author")}</dt>
          <dd>mikoto2000 &lt;mikoto2000@gmail.com&gt;</dd>
        </div>
        <div>
          <dt>{uiText("License")}</dt>
          <dd>MIT License</dd>
        </div>
      </dl>
      <div className="about-dialog-actions">
        <button ref={closeButtonRef} type="button" onClick={onClose}>OK</button>
      </div>
    </Dialog>
  );
}
