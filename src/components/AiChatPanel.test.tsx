import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { loadAiConfig, startAiDocumentChat } from "../lib/tauri";
import { AiChatPanel } from "./AiChatPanel";

vi.mock("../lib/tauri", () => ({
  cancelAiRequest: vi.fn(),
  loadAiConfig: vi.fn(),
  startAiDocumentChat: vi.fn(),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.resetAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function openChat(onOpenAiSettings = vi.fn()) {
  await act(async () => {
    root.render(<AiChatPanel filename="index.md" currentDocument="Sample"
      onOpenAiSettings={onOpenAiSettings} onClose={vi.fn()} />);
  });
}

function button(label: string) {
  return [...container.querySelectorAll("button")].find((item) => item.textContent === label)!;
}

test("shows the configuration load error summary and the original in collapsed details", async () => {
  const original = "key must be a string at line 1 column 2";
  vi.mocked(loadAiConfig).mockRejectedValue(original);
  const openSettings = vi.fn();
  await openChat(openSettings);

  expect(container.querySelector('[role="alert"]')?.textContent).toBe("AI 設定を読み込めませんでした。");
  const details = container.querySelector("details")!;
  expect(details.open).toBe(false);
  expect(details.querySelector("summary")?.textContent).toBe("詳細");
  act(() => details.querySelector("summary")!.click());
  expect(details.open).toBe(true);
  expect(details.querySelector(".error-detail")?.textContent).toBe(original);
  expect(button("送信").disabled).toBe(true);
  act(() => button("AI 設定").click());
  expect(openSettings).toHaveBeenCalledOnce();
});

test.each([
  ["", "AI から本文が返されませんでした。"],
  [" \n\t", "AI から本文が返されませんでした。"],
  ["通常の応答", "通常の応答"],
])("shows a message for a completed response with content %j", async (content, displayed) => {
  vi.mocked(loadAiConfig).mockResolvedValue({
    provider: "OpenAiCompatible", base_url: "http://localhost:11434/v1", model: "test",
    api_key: null, temperature: null, max_output_tokens: null,
    connect_timeout_seconds: null, request_timeout_seconds: null,
  });
  vi.mocked(startAiDocumentChat).mockImplementation(async (_request, onEvent) => {
    onEvent({ type: "started", request_id: "r1" });
    if (content) onEvent({ type: "delta", request_id: "r1", content });
    onEvent({ type: "completed", request_id: "r1" });
    return "r1";
  });
  await openChat();

  const input = container.querySelector("textarea")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "確認");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => button("送信").click());

  expect(container.querySelector(".ai-chat-assistant p")?.textContent).toBe(displayed);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(input.disabled).toBe(false);
});
