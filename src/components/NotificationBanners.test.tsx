import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { NotificationBanners, type BannerNotice } from "./NotificationBanners";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("NotificationBanners", () => {
  test("shows download notifications newest first with their status", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <NotificationBanners notices={[
        { id: 1, message: "Download started: report.pdf", tone: "info" },
        { id: 2, message: "Download completed: report.pdf", tone: "success" },
      ]} onDismiss={() => {}} />,
    ));

    const banners = [...container.querySelectorAll(".notification-banner")];
    expect(banners.map((banner) => banner.querySelector("[role]")?.textContent)).toEqual([
      "Download completed: report.pdf",
      "Download started: report.pdf",
    ]);
    expect(banners[0].classList).toContain("notification-banner-success");
    expect(container.querySelector('[aria-label="通知"]')).not.toBeNull();
    act(() => root.unmount());
  });

  test("pauses timed notices on hover and keeps errors until dismissed", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    function Notices() {
      const [notices, setNotices] = useState<BannerNotice[]>([
        { id: 1, message: "Finished", tone: "success" },
        { id: 2, message: "再読込できませんでした。", tone: "error", detail: "invalid folder document\ninvalid JSON" },
      ]);
      return <NotificationBanners notices={notices}
        onDismiss={(id) => setNotices((current) => current.filter((notice) => notice.id !== id))} />;
    }

    act(() => root.render(<Notices />));
    const success = container.querySelector(".notification-banner-success")!;
    act(() => vi.advanceTimersByTime(1000));
    act(() => success.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    act(() => vi.advanceTimersByTime(10_000));
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Finished");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("再読込できませんでした。");
    const details = container.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")?.textContent).toBe("詳細");
    act(() => details.querySelector("summary")!.click());
    expect(details.open).toBe(true);
    expect(details.querySelector(".error-detail")?.textContent).toBe("invalid folder document\ninvalid JSON");

    act(() => success.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })));
    act(() => vi.advanceTimersByTime(2499));
    expect(container.contains(success)).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(container.contains(success)).toBe(false);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("再読込できませんでした。");

    act(() => container.querySelector<HTMLButtonElement>('[aria-label="再読込できませんでした。 の通知を閉じる"]')!.click());
    expect(container.querySelector(".notification-banners")).toBeNull();
    act(() => root.unmount());
  });
});
