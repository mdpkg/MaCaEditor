import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AiSelectionActionDialog } from "./AiSelectionActionDialog";
import type { AiSelectionSnapshot } from "../lib/aiSelection";
import type { AiConfig } from "../types";

vi.mock("../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../lib/tauri")>("../lib/tauri");
  return {
    ...actual,
    loadAiConfig: vi.fn(),
    startAiSelectionAction: vi.fn(),
    cancelAiRequest: vi.fn(),
  };
});

import { loadAiConfig, startAiSelectionAction } from "../lib/tauri";

const loadMock = loadAiConfig as unknown as ReturnType<typeof vi.fn>;
const startMock = startAiSelectionAction as unknown as ReturnType<typeof vi.fn>;

const config: AiConfig = {
  provider: "OpenAiCompatible",
  base_url: "http://localhost:11434/v1",
  api_key: null,
  model: "qwen2.5",
  temperature: 0.7,
  max_output_tokens: 4096,
  connect_timeout_seconds: 10,
  request_timeout_seconds: 300,
};

const snapshot: AiSelectionSnapshot = { from: 4, to: 7, text: "BBB" };

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function emit(event: Parameters<Parameters<typeof startAiSelectionAction>[1]>[0]) {
  const calls = startMock.mock.calls;
  const call = calls[calls.length - 1]!;
  const onEvent = call[1];
  onEvent(event);
}

beforeEach(() => {
  loadMock.mockReset();
  startMock.mockReset();
  loadMock.mockResolvedValue(config);
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("AiSelectionActionDialog", () => {
  test("shows not configured message when AI is unconfigured", async () => {
    loadMock.mockResolvedValue({ ...config, model: "" });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<AiSelectionActionDialog task="Rewrite" snapshot={snapshot} onApply={vi.fn()} onOpenAiSettings={vi.fn()} onClose={vi.fn()} />);
    });
    expect(container.textContent).toContain("AI is not configured");
    act(() => root.unmount());
  });

  test("runs the task and streams result into the preview", async () => {
    startMock.mockImplementation(async () => "r1");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<AiSelectionActionDialog task="Rewrite" snapshot={snapshot} onApply={vi.fn()} onOpenAiSettings={vi.fn()} onClose={vi.fn()} />);
    });
    await act(async () => {
      const generate = [...container.querySelectorAll("button")].find((b) => b.textContent === "Generate");
      generate!.click();
    });
    expect(startMock).toHaveBeenCalledWith(
      expect.objectContaining({ task: "Rewrite", selectedText: "BBB" }),
      expect.any(Function),
    );
    await act(async () => {
      emit({ type: "delta", request_id: "r1", content: "he" });
      emit({ type: "delta", request_id: "r1", content: "llo" });
      emit({ type: "completed", request_id: "r1" });
    });
    expect(container.textContent).toContain("hello");
    expect(container.textContent).toContain("Replace Selection");
    act(() => root.unmount());
  });

  test("applies replace selection on button click", async () => {
    startMock.mockImplementation(async () => "r1");
    const onApply = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<AiSelectionActionDialog task="Rewrite" snapshot={snapshot} onApply={onApply} onOpenAiSettings={vi.fn()} onClose={vi.fn()} />);
    });
    await act(async () => {
      [...container.querySelectorAll("button")].find((b) => b.textContent === "Generate")!.click();
    });
    await act(async () => {
      emit({ type: "delta", request_id: "r1", content: "XXX" });
      emit({ type: "completed", request_id: "r1" });
    });
    await act(async () => {
      [...container.querySelectorAll("button")].find((b) => b.textContent === "Replace Selection")!.click();
    });
    expect(onApply).toHaveBeenCalledWith("replace", "XXX", snapshot);
    act(() => root.unmount());
  });

  test("cancels and disables apply", async () => {
    startMock.mockImplementation(async () => "r1");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<AiSelectionActionDialog task="Rewrite" snapshot={snapshot} onApply={vi.fn()} onOpenAiSettings={vi.fn()} onClose={vi.fn()} />);
    });
    await act(async () => {
      [...container.querySelectorAll("button")].find((b) => b.textContent === "Generate")!.click();
    });
    await act(async () => {
      emit({ type: "delta", request_id: "r1", content: "partial" });
      [...container.querySelectorAll("button")].find((b) => b.textContent === "Cancel")!.click();
    });
    expect(container.textContent).toContain("Cancelled");
    expect(container.textContent).not.toContain("Replace Selection");
    act(() => root.unmount());
  });

  test("shows error message on error state", async () => {
    startMock.mockImplementation(async () => "r1");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<AiSelectionActionDialog task="Rewrite" snapshot={snapshot} onApply={vi.fn()} onOpenAiSettings={vi.fn()} onClose={vi.fn()} />);
    });
    await act(async () => {
      [...container.querySelectorAll("button")].find((b) => b.textContent === "Generate")!.click();
    });
    await act(async () => {
      emit({ type: "error", request_id: "r1", error: { kind: "Timeout", message: "slow" } });
    });
    expect(container.textContent).toContain("timed out");
    expect(container.textContent).toContain("Retry");
    act(() => root.unmount());
  });
});
