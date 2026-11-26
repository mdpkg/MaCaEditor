import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { loadChatConnection, startAiDocumentChat, cancelAiRequest } from "../lib/tauri";
import { AiChatPanel } from "./AiChatPanel";
import { ChatSessionsController } from "../lib/chatSessionsController";

vi.mock("../lib/tauri", () => ({
  cancelAiRequest: vi.fn(),
  loadChatConnection: vi.fn(),
  startAiDocumentChat: vi.fn(),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let controller: ChatSessionsController;

beforeEach(() => {
  vi.resetAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); controller?.dispose(); });
  container.remove();
});

async function openChat(onOpenAiSettings = vi.fn(), onConfirm = vi.fn(async () => true)) {
  controller = new ChatSessionsController("doc", { connection: loadChatConnection, document: () => "Sample", send: startAiDocumentChat, cancel: cancelAiRequest });
  await controller.refreshConnection(); controller.add("index.md");
  await act(async () => { root.render(<AiChatPanel controller={controller} markdownPath="index.md" onConfirm={onConfirm} onOpenAiSettings={onOpenAiSettings} onClose={vi.fn()} />); });
}
function button(label: string) {
  return [...container.querySelectorAll("button")].find((item) => item.textContent === label)!;
}

test("shows the configuration load error summary and the original in collapsed details", async () => {
  const original = "key must be a string at line 1 column 2";
  vi.mocked(loadChatConnection).mockRejectedValue(original);
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
  vi.mocked(loadChatConnection).mockResolvedValue({
    endpoint: "http://localhost:11434", model: "test", revision: "rev",
  });
  vi.mocked(startAiDocumentChat).mockImplementation(async (request, onEvent) => {
    onEvent({ type: "started", request_id: request.requestId });
    if (content) onEvent({ type: "delta", request_id: request.requestId, content });
    onEvent({ type: "completed", request_id: request.requestId });
    return { request_id: request.requestId, content };
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


test("two synchronous send clicks start only one request", async () => {
  vi.mocked(loadChatConnection).mockResolvedValue({ endpoint: "http://localhost:11434", model: "test", revision: "rev", });
  let resolve!: (value: { request_id: string; content: string }) => void;
  let id = "";
  vi.mocked(startAiDocumentChat).mockImplementation((request) => {
    id = request.requestId;
    return new Promise((done) => { resolve = done; });
  });
  await openChat();
  const input = container.querySelector("textarea")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "question");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { const send = button("送信"); send.click(); send.click(); });
  await act(async () => resolve({ request_id: id, content: "authoritative" }));
  expect(vi.mocked(startAiDocumentChat)).toHaveBeenCalledOnce();
  expect(container.querySelector(".ai-chat-assistant p")?.textContent).toBe("authoritative");
});


test("clear during connection invalidates before cancellation and suppresses the late answer", async () => {
  vi.mocked(loadChatConnection).mockResolvedValue({ endpoint: "http://localhost", model: "reader", revision: "rev" });
  vi.mocked(cancelAiRequest).mockResolvedValue(false);
  let finish!: (value: { request_id: string; content: string }) => void;
  let id = "";
  vi.mocked(startAiDocumentChat).mockImplementation((request) => { id = request.requestId; return new Promise((resolve) => { finish = resolve; }); });
  await openChat();
  const sessionId = controller.getSnapshot().selectedSessionId!;
  act(() => controller.draft(sessionId, "question"));
  await act(async () => { void controller.send(sessionId); });
  expect(button("消去").disabled).toBe(false);
  await act(async () => button("消去").click());
  expect(vi.mocked(cancelAiRequest)).toHaveBeenCalledWith(id);
  await act(async () => finish({ request_id: id, content: "late" }));
  expect(container.querySelector(".ai-chat-assistant")).toBeNull();
});

test("connection confirmation applies only to this session and never sends by itself", async () => {
  vi.mocked(loadChatConnection).mockResolvedValue({ endpoint: "http://localhost", model: "reader", revision: "one" });
  vi.mocked(startAiDocumentChat).mockImplementation(async (request) => ({ request_id: request.requestId, content: "answer" }));
  await openChat();
  const id = controller.getSnapshot().selectedSessionId!;
  act(() => controller.draft(id, "question"));
  vi.mocked(loadChatConnection).mockResolvedValue({ endpoint: "https://example.test", model: "new", revision: "two" });
  await act(async () => controller.refreshConnection());
  expect(button("送信").disabled).toBe(true);
  act(() => button("この会話の送信先を確認").click());
  expect(vi.mocked(startAiDocumentChat)).not.toHaveBeenCalled();
  await act(async () => button("送信").click());
  expect(vi.mocked(startAiDocumentChat).mock.calls[0][0].expectedConnection).toBe("two");
  expect(Object.keys(vi.mocked(startAiDocumentChat).mock.calls[0][0])).not.toContain("apiKey");
});


test("closing the panel keeps generation alive and other tabs keep independent drafts", async () => {
  vi.mocked(loadChatConnection).mockResolvedValue({ endpoint: "http://localhost", model: "reader", revision: "rev" });
  vi.mocked(cancelAiRequest).mockResolvedValue(true);
  let finish!: (value: { request_id: string; content: string }) => void;
  let requestId = "";
  vi.mocked(startAiDocumentChat).mockImplementation((request) => { requestId = request.requestId; return new Promise((resolve) => { finish = resolve; }); });
  await openChat();
  const firstId = controller.getSnapshot().selectedSessionId!;
  act(() => controller.draft(firstId, "first question"));
  let pending!: Promise<void>;
  await act(async () => { pending = controller.send(firstId); });
  try {
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="文書相談を追加"]')!.click());
    const secondId = controller.getSnapshot().selectedSessionId!;
    expect(secondId === firstId).toBe(false);
    expect(container.querySelector("textarea")?.disabled).toBe(false);
    act(() => controller.draft(secondId, "second draft"));
    expect(button("送信").disabled).toBe(true);
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="AI チャットを閉じる"]')!.click());
    expect(vi.mocked(cancelAiRequest)).not.toHaveBeenCalled();
  } finally {
    await act(async () => { finish({ request_id: requestId, content: "background answer" }); await pending; });
  }
  expect(controller.getSnapshot().sessions[0].chat.messages[1].content).toBe("background answer");
  expect(controller.getSnapshot().sessions[1].draft).toBe("second draft");
});
test("selection changes during delete confirmation cannot delete a different conversation", async () => {
  vi.mocked(loadChatConnection).mockResolvedValue({ endpoint: "http://localhost", model: "reader", revision: "rev" });
  let confirm!: (value: boolean) => void;
  await openChat(vi.fn(), vi.fn(() => new Promise<boolean>((resolve) => { confirm = resolve; })));
  const firstId = controller.getSnapshot().selectedSessionId!;
  act(() => { controller.draft(firstId, "keep"); controller.add("guide.md"); });
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="文書相談 1を削除"]')!.click());
  act(() => controller.select(firstId));
  await act(async () => confirm(true));
  expect(controller.getSnapshot().sessions).toHaveLength(2);
  expect(controller.getSnapshot().sessions[0].draft).toBe("keep");
});

test("large Unicode paste is rejected before changing the existing draft", async () => {
  vi.mocked(loadChatConnection).mockResolvedValue({ endpoint: "http://localhost", model: "reader", revision: "rev" });
  await openChat(); const id = controller.getSnapshot().selectedSessionId!;
  act(() => controller.draft(id, "keep"));
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { getData: () => "😀".repeat(262145) } });
  act(() => container.querySelector("textarea")!.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
  expect(controller.getSnapshot().sessions[0].draft).toBe("keep");
});
test("answers do not create image requests or executable HTML and links use the validated external path", async () => {
  vi.mocked(loadChatConnection).mockResolvedValue({ endpoint: "http://localhost", model: "reader", revision: "rev" });
  vi.mocked(startAiDocumentChat).mockImplementation(async (request) => ({ request_id: request.requestId,
    content: '![external](https://example.test/track.png) <img src=x onerror=alert(1)> [safe](https://example.test/path) [bad](javascript:alert(1))' }));
  await openChat(); const id = controller.getSnapshot().selectedSessionId!;
  act(() => controller.draft(id, "question"));
  await act(async () => controller.send(id));
  expect(container.querySelector(".ai-chat-assistant img")).toBeNull();
  const link = container.querySelector<HTMLAnchorElement>('.ai-chat-assistant a[href="https://example.test/path"]')!;
  expect(link.rel).toContain("noreferrer");
  expect(container.querySelector('.ai-chat-assistant a[href^="javascript:"]')).toBeNull();
});

test("deleting the final empty tab returns focus to add without a confirmation", async () => {
  vi.mocked(loadChatConnection).mockResolvedValue({ endpoint: "http://localhost", model: "reader", revision: "rev" });
  const confirm = vi.fn(async () => true); await openChat(vi.fn(), confirm);
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="文書相談 1を削除"]')!.click());
  expect(confirm).not.toHaveBeenCalled();
  expect(controller.getSnapshot().sessions).toHaveLength(0);
  expect(document.activeElement).toBe(container.querySelector('button[aria-label="文書相談を追加"]'));
  act(() => container.querySelector<HTMLButtonElement>('button[aria-label="文書相談を追加"]')!.click());
  expect(controller.getSnapshot().sessions[0].title).toBe("文書相談 2");
  expect(document.activeElement).toBe(container.querySelector("textarea"));
});
test("scroll position and follow state are restored independently for each tab", async () => {
  vi.mocked(loadChatConnection).mockResolvedValue({ endpoint: "http://localhost", model: "reader", revision: "rev" });
  await openChat(); const id = controller.getSnapshot().selectedSessionId!;
  const list = container.querySelector<HTMLDivElement>(".ai-chat-messages")!;
  Object.defineProperties(list, { scrollHeight: { value: 1000 }, clientHeight: { value: 100 } });
  act(() => { list.scrollTop = 72; list.dispatchEvent(new Event("scroll", { bubbles: true })); controller.add("guide.md"); });
  act(() => controller.select(id));
  expect(controller.getSnapshot().sessions[0].follow).toBe(false);
  expect(container.querySelector<HTMLDivElement>(".ai-chat-messages")!.scrollTop).toBe(72);
});
test("IME Enter never sends and legacy IME Escape does not close the panel", async () => {
  vi.mocked(loadChatConnection).mockResolvedValue({ endpoint: "http://localhost", model: "reader", revision: "rev" });
  await openChat(); const close = vi.fn(), id = controller.getSnapshot().selectedSessionId!;
  act(() => { controller.draft(id, "question"); root.render(<AiChatPanel controller={controller} markdownPath="index.md" onClose={close} onOpenAiSettings={vi.fn()} />); });
  const input = container.querySelector("textarea")!;
  act(() => input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })));
  act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  act(() => input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })));
  act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 229, bubbles: true })));
  expect(vi.mocked(startAiDocumentChat)).not.toHaveBeenCalled();
  act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 229, bubbles: true })));
  expect(close).not.toHaveBeenCalled();
  act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(close).toHaveBeenCalledOnce();
});
