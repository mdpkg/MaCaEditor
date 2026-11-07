import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AiSettingsDialog } from "./AiSettingsDialog";
import * as tauri from "../lib/tauri";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("AiSettingsDialog", () => {
  test("renders AI settings fields and saves", async () => {
    vi.spyOn(tauri, "loadAiConfig").mockResolvedValue({
      provider: "OpenAiCompatible",
      base_url: "http://localhost:11434/v1",
      api_key: null,
      model: "qwen2.5",
      temperature: 0.7,
      max_output_tokens: 4096,
      connect_timeout_seconds: 10,
      request_timeout_seconds: 300,
    });
    const save = vi.spyOn(tauri, "saveAiConfig").mockResolvedValue();
    const onClose = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<AiSettingsDialog onClose={onClose} />);
    });

    const dialog = container.querySelector('[role="dialog"]');
    expect(document.getElementById(dialog!.getAttribute("aria-labelledby")!)?.textContent).toBe("AI 設定");
    expect(dialog?.textContent).toContain("ベース URL");
    expect(dialog?.textContent).toContain("モデル");
    expect(dialog?.textContent).toContain("接続タイムアウト");
    expect(dialog?.textContent).toContain("リクエストタイムアウト");

    await act(async () => {
      (container.querySelectorAll("button")[3] as HTMLButtonElement).click();
    });
    expect(save).toHaveBeenCalledOnce();
    expect(dialog?.textContent).toContain("保存しました。");
    act(() => root.unmount());
  });

  test("shows connecting status while testing connection", async () => {
    vi.spyOn(tauri, "loadAiConfig").mockResolvedValue({
      provider: "OpenAiCompatible",
      base_url: "http://localhost:11434/v1",
      api_key: null,
      model: "qwen2.5",
      temperature: 0.7,
      max_output_tokens: 4096,
      connect_timeout_seconds: 10,
      request_timeout_seconds: 300,
    });
    let resolveTest: (() => void) | undefined;
    vi.spyOn(tauri, "testAiConnection").mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveTest = resolve;
        }),
    );
    const onClose = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<AiSettingsDialog onClose={onClose} />);
    });

    // Test Connection ボタン（Refresh Models の次、index 2）を押す
    await act(async () => {
      (container.querySelectorAll("button")[2] as HTMLButtonElement).click();
    });
    expect(container.textContent).toContain("接続しています…");
    // 接続中はスピナーが表示される
    expect(container.querySelector(".ai-spinner")).not.toBeNull();

    // 接続Doneで表示が切り替わる
    await act(async () => {
      resolveTest?.();
    });
    expect(container.textContent).toContain("接続できました。");
    expect(container.querySelector(".ai-spinner")).toBeNull();
    act(() => root.unmount());
  });

  test.each([
    [new Error("connection refused"), "接続できませんでした。", "connection refused"],
    [{ kind: "AuthenticationFailed", message: "upstream rejected credentials" },
      "接続できませんでした。AI の認証に失敗しました。API キーを確認してください。", "upstream rejected credentials"],
  ])("shows error detail when test connection fails (%s)", async (error, summary, message) => {
    vi.spyOn(tauri, "loadAiConfig").mockResolvedValue({
      provider: "OpenAiCompatible",
      base_url: "http://localhost:11434/v1",
      api_key: null,
      model: "qwen2.5",
      temperature: 0.7,
      max_output_tokens: 4096,
      connect_timeout_seconds: 10,
      request_timeout_seconds: 300,
    });
    vi.spyOn(tauri, "testAiConnection").mockRejectedValue(
      error,
    );
    const onClose = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<AiSettingsDialog onClose={onClose} />);
    });

    await act(async () => {
      (container.querySelectorAll("button")[2] as HTMLButtonElement).click();
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(summary);
    const details = container.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")?.textContent).toBe("詳細");
    act(() => details.querySelector("summary")!.click());
    expect(details.open).toBe(true);
    expect(details.querySelector(".error-detail")?.textContent).toBe(message);
    act(() => root.unmount());
  });

  test("shows error when save fails", async () => {
    vi.spyOn(tauri, "loadAiConfig").mockRejectedValue(new Error("no config"));
    vi.spyOn(tauri, "saveAiConfig").mockRejectedValue(new Error("boom"));
    const onClose = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<AiSettingsDialog onClose={onClose} />);
    });

    await act(async () => {
      (container.querySelectorAll("button")[3] as HTMLButtonElement).click();
    });
    expect(container.textContent).toContain("保存できませんでした。");
    act(() => root.unmount());
  });
});
