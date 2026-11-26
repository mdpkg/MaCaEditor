import { expect, test } from "vitest";
import { ChatSessionsController } from "./chatSessionsController";
import type { AiStreamEvent } from "../types";
const connection = { endpoint: "http://localhost", model: "reader", revision: "one" };

test("controller captures the bound file and ignores completion after document disposal", async () => {
  let finish!: (value: { request_id: string; content: string }) => void;
  let requestId = "";
  let source = "latest bound document";
  let payload: unknown;
  const controller = new ChatSessionsController("doc", {
    connection: async () => connection, document: (path) => path === "index.md" ? source : "WRONG FILE",
    send: (request) => { payload = request; requestId = request.requestId; return new Promise((resolve) => { finish = resolve; }); }, cancel: async () => false,
  });
  await controller.refreshConnection();
  const id = controller.add("index.md")!;
  controller.draft(id, "question");
  source = "edited before send";
  const pending = controller.send(id);
  expect(payload).toMatchObject({ currentDocument: "edited before send", filename: "index.md", expectedConnection: "one" });
  controller.dispose();
  finish({ request_id: requestId, content: "late" });
  await pending;
  expect(controller.getSnapshot().sessions).toEqual([]);
});
test("settings changes invalidate before cancellation and require per-session confirmation", async () => {
  let current = connection;
  let deliver!: (event: AiStreamEvent) => void;
  let finish!: (value: { request_id: string; content: string }) => void;
  let id = "";
  const controller = new ChatSessionsController("doc", {
    connection: async () => current, document: () => "document",
    send: (request, onEvent) => { deliver = onEvent; id = request.requestId; return new Promise((resolve) => { finish = resolve; }); },
    cancel: async () => { expect(controller.getSnapshot().sessions[0].terminal).toBe(true); return true; },
  });
  await controller.refreshConnection();
  const sessionId = controller.add("index.md")!;
  controller.draft(sessionId, "question");
  const pending = controller.send(sessionId);
  current = { ...connection, revision: "two", endpoint: "https://example.test" };
  await controller.refreshConnection();
  deliver({ type: "delta", request_id: id, content: "stale" });
  finish({ request_id: id, content: "stale" });
  await pending;
  const session = controller.getSnapshot().sessions[0];
  expect(session.pendingConnectionConfirmation).toBe(true);
  expect(session.chat.messages[1].content).toBe("");
  controller.confirm(sessionId, "two");
  expect(controller.getSnapshot().sessions[0].pendingConnectionConfirmation).toBe(false);
});

test("late connection mismatch cannot restore a cleared draft", async () => {
  let reject!: (reason: unknown) => void;
  const controller = new ChatSessionsController("doc", {
    connection: async () => connection, document: () => "source",
    send: () => new Promise((_, fail) => { reject = fail; }), cancel: async () => false,
  });
  await controller.refreshConnection();
  const id = controller.add("index.md")!;
  controller.draft(id, "must not return");
  const pending = controller.send(id);
  controller.clear(id);
  reject({ kind: "InvalidConfiguration", message: "chat_connection_changed" });
  await pending;
  expect(controller.getSnapshot().sessions[0].draft).toBe("");
  expect(controller.getSnapshot().sessions[0].chat.messages).toEqual([]);
});

test("an oversized question is rejected before reading the bound document", async () => {
  let reads = 0, sends = 0;
  const controller = new ChatSessionsController("doc", { connection: async () => connection,
    document: () => { reads++; return "source"; }, send: async (request) => { sends++; return { request_id: request.requestId, content: "answer" }; }, cancel: async () => false });
  await controller.refreshConnection(); const id = controller.add("index.md")!;
  controller.draft(id, "x".repeat(900000)); await controller.send(id);
  expect(reads).toBe(0); expect(sends).toBe(0);
  expect(controller.getSnapshot().sessions[0].draft.length).toBe(900000);
});
