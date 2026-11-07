import { uiText } from "../lib/uiText";
interface Props {
  message: string;
  mode?: "Package" | "Folder";
  location?: string;
  onShowErrorDetails?: () => void;
}

export function StatusBar({ message, mode, location, onShowErrorDetails }: Props) {
  return <div className="status-bar">
    <div className="status-summary">
      <span className="status-message" title={message}>{message}</span>
      {onShowErrorDetails && (
        <button type="button" className="status-error-details" aria-haspopup="dialog" onClick={onShowErrorDetails}>
          {uiText("Error details")}
        </button>
      )}
    </div>
    {mode && <span className="document-origin" title={location}>{uiText(mode)}{location ? ` — ${location}` : ""}</span>}
  </div>;
}
