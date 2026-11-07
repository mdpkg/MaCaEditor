import { uiText } from "../lib/uiText";
import { Dialog } from "./Dialog";
import { ErrorDetails } from "./ErrorDetails";
import type { BannerNotice, NotificationTone } from "./NotificationBanners";

export type NotificationHistoryEntry = Omit<BannerNotice, "action"> & { time: number };

const toneLabels: Record<NotificationTone, string> = {
  info: "情報",
  success: "完了",
  warning: "警告",
  error: "エラー",
};

const localTime = new Intl.DateTimeFormat("ja-JP", { dateStyle: "short", timeStyle: "medium" });

export function NotificationHistoryDialog({ entries, onClose }: {
  entries: NotificationHistoryEntry[];
  onClose: () => void;
}) {
  return (
    <Dialog title={uiText("Notification history")} onClose={onClose}>
      {entries.length === 0 ? <p>{uiText("No notifications yet.")}</p> : (
        <ol className="notification-history" tabIndex={0}>
          {entries.map(({ id, tone, message, detail, time }) => (
            <li key={id}>
              <div className="notification-history-meta">
                {toneLabels[tone]}{" · "}
                <time dateTime={new Date(time).toISOString()}>{localTime.format(time)}</time>
              </div>
              <div>{message}</div>
              {detail && <ErrorDetails detail={detail} />}
            </li>
          ))}
        </ol>
      )}
      <div className="about-dialog-actions">
        <button type="button" onClick={onClose}>{uiText("Close")}</button>
      </div>
    </Dialog>
  );
}
