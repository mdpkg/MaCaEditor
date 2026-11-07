import { uiText } from "../lib/uiText";
interface Props {
  message: string;
  mode?: "Package" | "Folder";
  location?: string;
  onShowErrorDetails?: () => void;
  onShowNotificationHistory?: () => void;
}

export function StatusBar({ message, mode, location, onShowErrorDetails, onShowNotificationHistory }: Props) {
  return <div className="status-bar">
    <div className="status-summary">
      <span className="status-message" title={message}>{message}</span>
      {onShowErrorDetails && (
        <button type="button" className="status-error-details" aria-haspopup="dialog" onClick={onShowErrorDetails}>
          {uiText("Error details")}
        </button>
      )}
      {onShowNotificationHistory && (
        <button type="button" className="status-notification-history" aria-haspopup="dialog" onClick={onShowNotificationHistory}>
          {uiText("Notification history")}
        </button>
      )}
    </div>
    {mode && <span className="document-origin" title={location}>{uiText(mode)}{location ? ` — ${location}` : ""}</span>}
  </div>;
}
