import { expect, test } from "vitest";
import { ChatTransport } from "./chatTransport";
import type { AiStreamEvent } from "../types";

test("keeps the physical slot until command settles even after logical invalidation", async () => {
  let finish!: (value: { request_id: string; content: string }) => void;
  let deliver!: (event: AiStreamEvent) => void;
  const events: unknown[] = [];
  const transport = new ChatTransport((_id, onEvent) => {
    deliver = onEvent;
    return new Promise((resolve) => { finish = resolve; });
  }, async () => true);
  const owner = { documentScopeKey: "doc", sessionId: "tab", generation: 1, requestId: crypto.randomUUID() };
  const request = transport.send(owner, (event) => events.push(event));
  expect(transport.busy).toBe(true);
  transport.invalidate();
  expect(transport.busy).toBe(true);
  await expect(transport.send({ ...owner, requestId: crypto.randomUUID() }, () => {})).rejects.toThrow("busy");
  deliver({ type: "delta", request_id: owner.requestId, content: "stale" });
  finish({ request_id: owner.requestId, content: "answer" });
  await request;
  expect(events).toEqual([]);
  expect(transport.busy).toBe(false);
});

test("only command completion commits the authoritative full answer once", async () => {
  const id = crypto.randomUUID();
  const events: AiStreamEvent[] = [];
  const transport = new ChatTransport(async (_, deliver) => {
    deliver({ type: "completed", request_id: id });
    deliver({ type: "delta", request_id: id, content: "partial" });
    return { request_id: id, content: "full answer" };
  }, async () => true);
  const result = await transport.send({ documentScopeKey: "d", sessionId: "s", generation: 1, requestId: id }, (event) => events.push(event));
  expect(events.map((event) => event.type)).toEqual(["delta"]);
  expect(result?.content).toBe("full answer");
});


test("rejects an oversized final response even if no deltas were delivered", async () => {
  const id = crypto.randomUUID();
  const transport = new ChatTransport(async () => ({ request_id: id, content: "あ".repeat(22000) }), async () => true);
  await expect(transport.send({ documentScopeKey: "d", sessionId: "s", generation: 0, requestId: id }, () => {})).rejects.toThrow("64 KiB");
  expect(transport.busy).toBe(false);
});
