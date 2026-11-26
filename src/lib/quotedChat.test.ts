import { expect, test, vi } from "vitest";
import { ChatSessionsController } from "./chatSessionsController";
import { copyQuotedChat } from "./quotedChat";
const connection = { endpoint: "https://reader.test", model: "reader", revision: "one" };
const quote = { commentId: "comment-one", documentScopeKey: "doc", path: "a.md", context: { target: "引用", previous: "前" },
  reaction: "反応", reactionType: "reaction" as const, personality: "生成時の読者", connection };
test("quote copies a bounded whitelist and safe origin, and rejects absolute paths and oversized context", () => {
  const input = { ...quote, secret: "NEVER", connection: { ...connection, endpoint: "https://user:password@reader.test/v1?secret=NEVER", apiKey: "NEVER" } };
  expect(JSON.stringify(copyQuotedChat(input))).not.toMatch(/NEVER|password|user:/);
  expect(copyQuotedChat({ ...quote, path: "C:/private/a.md" })).toBeUndefined();
  expect(copyQuotedChat({ ...quote, context: { target: "😀".repeat(2001) } })).toBeUndefined();
});
test("session cap leaves the selected session and allows duplicate selection without adding", async () => {
  const controller = new ChatSessionsController("doc", { connection: async () => connection, document: () => "", send: vi.fn(), cancel: async () => false });
  const id = controller.addQuote(quote)!;
  for (let i = 0; i < 19; i++) controller.add("a.md");
  expect(controller.addQuote({ ...quote, commentId: "different" })).toBeUndefined();
  expect(controller.getSnapshot().sessions).toHaveLength(20);
  expect(controller.addQuote(quote)).toBe(id);
  controller.dispose();
});
test("quoted conversations deduplicate, keep fixed data on clear, and never read the document", async () => {
  const document = vi.fn(() => { throw new Error("must not read full document"); });
  const send = vi.fn(async (request) => ({ request_id: request.requestId, content: "answer" }));
  const sendQuote = vi.fn(async (request) => ({ request_id: request.requestId, content: "reader answer" }));
  const controller = new ChatSessionsController("doc", { connection: async () => connection, document, send, sendQuote, cancel: async () => false });
  await controller.refreshConnection();
  const id = controller.addQuote(quote)!;
  expect(controller.addQuote(quote)).toBe(id);
  controller.initialize("other.md");
  expect(controller.getSnapshot().sessions).toHaveLength(1);
  controller.draft(id, "why?"); await controller.send(id);
  expect(document).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  expect(sendQuote).toHaveBeenCalledWith(expect.objectContaining({ quote, history: [], question: "why?" }), expect.any(Function));
  controller.paths([{ from: "a.md" }]);
  expect(controller.getSnapshot().sessions[0].available).toBe(true);
  controller.clear(id); expect(controller.getSnapshot().sessions[0].quote).toEqual(quote);
  expect(controller.getSnapshot().sessions[0].chat.messages).toEqual([]);
  controller.dispose();
});
test("old scopes are rejected and generation connection requires explicit session confirmation", async () => {
  const controller = new ChatSessionsController("doc", { connection: async () => ({ ...connection, revision: "two" }), document: () => "",
    send: vi.fn(), sendQuote: vi.fn(), cancel: async () => false });
  await controller.refreshConnection();
  expect(controller.addQuote({ ...quote, documentScopeKey: "old" })).toBeUndefined();
  const id = controller.addQuote(quote)!;
  expect(controller.getSnapshot().sessions[0].pendingConnectionConfirmation).toBe(true);
  controller.confirm(id, "two"); expect(controller.getSnapshot().sessions[0].pendingConnectionConfirmation).toBe(false);
  controller.dispose();
});
