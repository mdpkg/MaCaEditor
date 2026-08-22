import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test } from "vitest";
import { NotificationBanners } from "./NotificationBanners";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("NotificationBanners", () => {
  test("shows download notifications newest first with their status", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <NotificationBanners notices={[
        { id: 1, message: "ダウンロードを開始しました: report.pdf", tone: "info" },
        { id: 2, message: "ダウンロードが完了しました: report.pdf", tone: "success" },
      ]} />,
    ));

    const banners = [...container.querySelectorAll(".notification-banner")];
    expect(banners.map((banner) => banner.textContent)).toEqual([
      "ダウンロードが完了しました: report.pdf",
      "ダウンロードを開始しました: report.pdf",
    ]);
    expect(banners[0].classList).toContain("notification-banner-success");
    expect(container.querySelector('[aria-label="通知"]')).not.toBeNull();
    act(() => root.unmount());
  });
});
