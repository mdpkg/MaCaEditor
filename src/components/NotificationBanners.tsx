import { uiText } from "../lib/uiText";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ErrorDetails } from "./ErrorDetails";

export type NotificationTone = "info" | "success" | "warning" | "error";

export interface BannerNotice {
  id: number;
  message: string;
  tone: NotificationTone;
  detail?: string;
  action?: { label: string; onClick: () => void };
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
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (tone === "error" || tone === "warning" || notice.action || hovered || focused) return;
    const started = performance.now();
    const timer = window.setTimeout(() => onDismiss(id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (performance.now() - started));
    };
  }, [hovered, focused, id, onDismiss, tone, notice.action]);

  return (
    <div className={`notification-banner notification-banner-${tone}`}
      onFocusCapture={() => setFocused(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <div role={tone === "error" ? "alert" : "status"}>{message}</div>
      {notice.detail && <ErrorDetails detail={notice.detail} />}
      {notice.action && <button type="button" onClick={() => { notice.action?.onClick(); onDismiss(id); }}>{notice.action.label}</button>}
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
