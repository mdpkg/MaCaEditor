import { uiText } from "../lib/uiText";
import { useEffect, useRef, useState, type ReactNode } from "react";

export type NotificationTone = "info" | "success" | "error";

export interface BannerNotice {
  id: number;
  message: string;
  tone: NotificationTone;
}

interface Props {
  notices: BannerNotice[];
  onDismiss: (id: number) => void;
  children?: ReactNode;
}

function NotificationBanner({ notice, onDismiss }: { notice: BannerNotice; onDismiss: Props["onDismiss"] }) {
  const { id, message, tone } = notice;
  const remaining = useRef(3500);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    if (tone === "error" || hovered) return;
    const started = performance.now();
    const timer = window.setTimeout(() => onDismiss(id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (performance.now() - started));
    };
  }, [hovered, id, onDismiss, tone]);

  return (
    <div className={`notification-banner notification-banner-${tone}`}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <div role={tone === "error" ? "alert" : "status"}>{message}</div>
      <button type="button" aria-label={`${message} の通知を閉じる`} onClick={() => onDismiss(id)}>
        {uiText("Dismiss")}</button>
    </div>
  );
}

export function NotificationBanners({ notices, onDismiss, children }: Props) {
  if (notices.length === 0 && !children) return null;
  return (
    <div className="notification-banners" role="region" aria-label={uiText("Notifications")}>
      {children}
      {[...notices].reverse().map((notice) => (
        <NotificationBanner key={notice.id} notice={notice} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
