export type NotificationTone = "info" | "success" | "error";

export interface BannerNotice {
  id: number;
  message: string;
  tone: NotificationTone;
}

interface Props {
  notices: BannerNotice[];
}

export function NotificationBanners({ notices }: Props) {
  if (notices.length === 0) return null;
  return (
    <div className="notification-banners" role="region" aria-label="通知">
      {[...notices].reverse().map((notice) => (
        <div
          key={notice.id}
          className={`notification-banner notification-banner-${notice.tone}`}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          {notice.message}
        </div>
      ))}
    </div>
  );
}
