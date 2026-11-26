import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { useAiChatSessions } from "./useAiChatSessions";
import { loadChatConnection, startAiDocumentChat } from "../lib/tauri";
import type { ChatSessionsController } from "../lib/chatSessionsController";
import type { AiStreamEvent } from "../types";
vi.mock("../lib/tauri", () => ({ loadChatConnection: vi.fn(), startAiQuotedChat: vi.fn(), startAiDocumentChat: vi.fn(), cancelAiRequest: vi.fn(async () => true) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
test("a saved-settings callback refreshes the current document after a scope replacement", async () => {
  let revision = "one";
  vi.mocked(loadChatConnection).mockImplementation(async () => ({ endpoint: "https://reader.test", model: "reader", revision }));
  let current!: ReturnType<typeof useAiChatSessions>;
  function Harness({ scope }: { scope: string }) { current = useAiChatSessions(scope, () => "source"); return null; }
  const container = document.createElement("div"), root = createRoot(container);
  await act(async () => root.render(<Harness scope="old" />));
  const savedCallback = current.refreshConnection, old = current.controller!;
  await act(async () => root.render(<Harness scope="new" />));
  revision = "two"; await act(async () => savedCallback());
  expect(current.controller!.scope).toBe("new"); expect(current.controller!.getSnapshot().connection?.revision).toBe("two");
  expect(old.getSnapshot().sessions).toEqual([]);
  await act(async () => root.unmount());
});
test("streaming text updates the panel store without rerendering the editor's App owner", async () => {
  vi.mocked(loadChatConnection).mockResolvedValue({ endpoint: "http://localhost", model: "reader", revision: "rev" });
  let finish!: (value: { request_id: string; content: string }) => void, deliver!: (event: AiStreamEvent) => void;
  let id = "";
  vi.mocked(startAiDocumentChat).mockImplementation((request, onEvent) => { id = request.requestId; deliver = onEvent; return new Promise((resolve) => { finish = resolve; }); });
  let renders = 0, instance: ChatSessionsController | undefined;
  function Harness() { renders++; instance = useAiChatSessions("doc", () => "source").controller; return null; }
  const container = document.createElement("div"), root = createRoot(container);
  await act(async () => root.render(<Harness />));
  const controller = instance!; let sessionId = "";
  act(() => { sessionId = controller.add("index.md")!; controller.draft(sessionId, "question"); });
  let pending!: Promise<void>;
  await act(async () => { pending = controller.send(sessionId); });
  try {
    act(() => deliver({ type: "started", request_id: id }));
    const before = renders;
    act(() => deliver({ type: "delta", request_id: id, content: "partial" }));
    expect(renders).toBe(before);
    expect(controller.getSnapshot().sessions[0].chat.messages[1].content).toBe("partial");
  } finally { await act(async () => { finish({ request_id: id, content: "answer" }); await pending; root.unmount(); }); }
});
