import { useCallback, useRef, useState } from "react";
import type { BannerNotice, NotificationTone } from "../components/NotificationBanners";
import type { NotificationHistoryEntry } from "../components/NotificationHistoryDialog";
import { uiText } from "../lib/uiText";

const fileOperationsRequiringErrorTranslation = new Set([
  "Save", "Reload folder", "Export folder", "Export package", "Print", "Print monitoring",
  "Add images", "Add attachments", "Download attachment", "Add image to drawing", "Move", "Save editor settings",
].map(uiText));
export function errorDetail(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  return message.trim() ? message : uiText("Unknown error");
}

/** Own notification IDs, bounded history, and the error presentation lifecycle. */
export function useAppNotifications(onError: (summary: string) => void) {
  const [error, setError] = useState<{
    operation: string;
    summary: string;
    detail: string;
    presentation: "banner" | "dismissed" | "details";
  } | null>(null);
  const [notifications, setNotifications] = useState<BannerNotice[]>([]);
  const [notificationHistory, setNotificationHistory] = useState<NotificationHistoryEntry[]>([]);
  const notificationSequenceRef = useRef(0);

  const recordNotification = useCallback((message: string, tone: NotificationTone, detail?: string) => {
    const id = ++notificationSequenceRef.current;
    const entry: NotificationHistoryEntry = { id, message, tone, detail, time: Date.now() };
    setNotificationHistory((current) => [entry, ...current].slice(0, 50));
    return id;
  }, []);

  const reportError = useCallback((operation: string, reason: unknown) => {
    const detail = errorDetail(reason);
    const firstLine = detail.trim().split(/\r?\n/, 1)[0];
    const shortReason = firstLine.length > 120 ? `${firstLine.slice(0, 119)}…` : firstLine;
    const translated = uiText(shortReason);
    // File errors can contain Japanese paths or Windows messages alongside English text.
    const localized = typeof translated === "string" && (
      translated !== shortReason ||
      (!fileOperationsRequiringErrorTranslation.has(operation) && /[ぁ-んァ-ヶ一-龠]/.test(translated))
    );
    const reasonText = localized ? translated : "詳しくは詳細欄を確認してください。";
    const summary = `${uiText(operation)}に失敗しました。${reasonText}`;
    recordNotification(summary, "error", detail);
    setError({ operation, summary, detail, presentation: "banner" });
    onError(summary);
  }, [recordNotification, onError]);

  const clearError = useCallback((operation: string) => {
    setError((current) => current?.operation === operation ? null : current);
  }, []);

  const dismissError = () => {
    setError((current) => current && { ...current, presentation: "dismissed" });
  };

  const showNotification = (message: string, tone: NotificationTone, options?: Pick<BannerNotice, "action" | "detail">) => {
    const id = recordNotification(message, tone, options?.detail);
    const notice: BannerNotice = { id, message, tone, ...options };
    setNotifications((current) => [...current, notice]);
  };

  const dismissNotification = useCallback((id: number) => {
    setNotifications((current) => current.filter((notice) => notice.id !== id));
  }, []);

  const resetDocumentNotifications = () => {
    setError(null);
    setNotifications((current) => current.filter((notice) => !notice.action));
  };

  const showErrorDetails = () => {
    setError((current) => current?.presentation === "dismissed" ? { ...current, presentation: "details" } : current);
  };

  return {
    error, notifications, notificationHistory, reportError, clearError, dismissError,
    showNotification, dismissNotification, resetDocumentNotifications, showErrorDetails,
  };
}
