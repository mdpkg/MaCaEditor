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
    expect(dialog?.getAttribute("aria-label")).toBe("AI Settings");
    expect(dialog?.textContent).toContain("Base URL");
    expect(dialog?.textContent).toContain("Model");

    await act(async () => {
      (container.querySelectorAll("button")[3] as HTMLButtonElement).click();
    });
    expect(save).toHaveBeenCalledOnce();
    expect(dialog?.textContent).toContain("Saved.");
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
    expect(container.textContent).toContain("Failed to save.");
    act(() => root.unmount());
  });
});
