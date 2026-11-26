import { expect, test, vi } from "vitest";
import { ChatSessionsController } from "./chatSessionsController";
import { chatRequestOwner, isChatTransportBusy } from "./chatTransport";
import type { AiStreamEvent } from "../types";
test("one hundred document replacements release sessions and isolate late answers without releasing a live physical slot", async () => {
  const connection = { revision: "one", endpoint: "https://reader.test", model: "reader" };
  for (let index = 0; index < 100; index++) {
    const scope = String(index); let finish!: (result: { request_id: string; content: string }) => void;
    let deliver!: (event: AiStreamEvent) => void, requestId = "";
    const cancel = vi.fn(async () => false), listener = vi.fn();
    const controller = new ChatSessionsController(scope, { connection: async () => connection, document: () => "source",
      send: (request, receive) => { deliver = receive; requestId = request.requestId; return new Promise((resolve) => { finish = resolve; }); }, cancel });
    await controller.refreshConnection(); controller.subscribe(listener);
    const id = controller.add("a.md")!;
    controller.addQuote({ commentId: `comment-${index}`, documentScopeKey: scope, path: "a.md", context: { target: "fixed" },
      reaction: "reader", reactionType: "reaction", personality: "fixed reader", connection });
    controller.draft(id, "question"); const pending = controller.send(id);
    expect(isChatTransportBusy()).toBe(true);
    if (index % 3 === 0) controller.clear(id); else if (index % 3 === 1) controller.delete(id);
    controller.dispose(); const notifications = listener.mock.calls.length;
    expect(controller.getSnapshot().sessions).toEqual([]); expect(isChatTransportBusy()).toBe(true);
    deliver({ type: "delta", request_id: requestId, content: "late delta" });
    finish({ request_id: requestId, content: "late authoritative answer" }); await pending;
    expect(listener).toHaveBeenCalledTimes(notifications); expect(cancel).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().sessions).toEqual([]); expect(isChatTransportBusy()).toBe(false); expect(chatRequestOwner()).toBeUndefined();
  }
});
