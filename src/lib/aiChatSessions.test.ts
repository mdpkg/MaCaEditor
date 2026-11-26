import { expect, test } from "vitest";
import { createAiChatSessions, reduceAiChatSessions } from "./aiChatSessions";
const scope = "document-1";
const add = (id: string, path: string) => ({ type: "add" as const, documentScopeKey: scope, sessionId: id, path });

test("sessions retain independent drafts and selection does not change their targets", () => {
  let state = createAiChatSessions(scope);
  state = reduceAiChatSessions(state, add("one", "index.md"));
  state = reduceAiChatSessions(state, { type: "draft", documentScopeKey: scope, sessionId: "one", value: "first draft" });
  state = reduceAiChatSessions(state, add("two", "guide.md"));
  state = reduceAiChatSessions(state, { type: "select", documentScopeKey: scope, sessionId: "one" });
  expect(state.sessions.map((session) => [session.title, session.path, session.draft])).toEqual([
    ["文書相談 1", "index.md", "first draft"], ["文書相談 2", "guide.md", ""],
  ]);
  expect(state.selectedSessionId).toBe("one");
});
test("deleting the final session leaves an empty state and numbers are never reused", () => {
  let state = reduceAiChatSessions(createAiChatSessions(scope), add("one", "index.md"));
  state = reduceAiChatSessions(state, { type: "delete", documentScopeKey: scope, sessionId: "one" });
  expect(state.sessions).toEqual([]);
  expect(state.selectedSessionId).toBeUndefined();
  state = reduceAiChatSessions(state, add("two", "index.md"));
  expect(state.sessions[0].title).toBe("文書相談 2");
});
test("old document actions cannot mutate the current document", () => {
  const state = createAiChatSessions("document-2");
  expect(reduceAiChatSessions(state, add("old", "index.md"))).toBe(state);
});

test("request deltas belong to their session and stale generations cannot resurrect cleared history", () => {
  let state = reduceAiChatSessions(createAiChatSessions(scope), add("one", "index.md"));
  state = reduceAiChatSessions(state, add("two", "guide.md"));
  const owner = { documentScopeKey: scope, sessionId: "one", generation: 1, requestId: "request" };
  state = reduceAiChatSessions(state, { type: "begin", documentScopeKey: scope, owner, question: "question" });
  state = reduceAiChatSessions(state, { type: "delta", documentScopeKey: scope, owner, content: "partial" });
  expect(state.selectedSessionId).toBe("two");
  expect(state.sessions[0].chat.messages[1].content).toBe("partial");
  expect(state.sessions[1].chat.messages).toEqual([]);
  state = reduceAiChatSessions(state, { type: "clear", documentScopeKey: scope, sessionId: "one" });
  const cleared = state;
  state = reduceAiChatSessions(state, { type: "complete", documentScopeKey: scope, owner, content: "late" });
  expect(state).toBe(cleared);
});
test("a second request is rejected while another session is generating", () => {
  let state = reduceAiChatSessions(createAiChatSessions(scope), add("one", "index.md"));
  state = reduceAiChatSessions(state, add("two", "guide.md"));
  state = reduceAiChatSessions(state, { type: "begin", documentScopeKey: scope, owner: { documentScopeKey: scope, sessionId: "one", generation: 1, requestId: "r1" }, question: "first" });
  const before = state;
  state = reduceAiChatSessions(state, { type: "begin", documentScopeKey: scope, owner: { documentScopeKey: scope, sessionId: "two", generation: 1, requestId: "r2" }, question: "second" });
  expect(state.sessions[1]).toEqual(before.sessions[1]);
});
test("connection confirmation is revision-bound and independent for every session", () => {
  let state = reduceAiChatSessions(createAiChatSessions(scope), { type: "connection", documentScopeKey: scope, connection: { revision: "old", endpoint: "http://localhost", model: "m" } });
  state = reduceAiChatSessions(state, add("one", "index.md"));
  state = reduceAiChatSessions(state, add("two", "guide.md"));
  state = reduceAiChatSessions(state, { type: "connection", documentScopeKey: scope, connection: { revision: "new", endpoint: "https://example.test", model: "n" } });
  expect(state.sessions.every((session) => session.pendingConnectionConfirmation)).toBe(true);
  state = reduceAiChatSessions(state, { type: "confirm", documentScopeKey: scope, sessionId: "one", revision: "old" });
  expect(state.sessions[0].pendingConnectionConfirmation).toBe(true);
  state = reduceAiChatSessions(state, { type: "confirm", documentScopeKey: scope, sessionId: "one", revision: "new" });
  expect(state.sessions.map((session) => session.pendingConnectionConfirmation)).toEqual([false, true]);
});

test("caps sessions at twenty without deleting existing sessions", () => {
  let state = createAiChatSessions(scope);
  for (let i = 0; i < 21; i++) state = reduceAiChatSessions(state, add(String(i), "index.md"));
  expect(state.sessions).toHaveLength(20);
  expect(state.sessions[0].id).toBe("0");
  expect(state.notice).toBeTruthy();
});
test("rejects an oversized UTF-8 draft and protects the previous value", () => {
  let state = reduceAiChatSessions(createAiChatSessions(scope), add("one", "index.md"));
  state = reduceAiChatSessions(state, { type: "draft", documentScopeKey: scope, sessionId: "one", value: "keep" });
  state = reduceAiChatSessions(state, { type: "draft", documentScopeKey: scope, sessionId: "one", value: "あ".repeat(350000) });
  expect(state.sessions[0].draft === "keep").toBe(true);
});
test("counts question limits in Unicode characters rather than UTF-16 code units", () => {
  const initial = reduceAiChatSessions(createAiChatSessions(scope), add("one", "index.md"));
  const owner = { documentScopeKey: scope, sessionId: "one", generation: 1, requestId: "r" };
  let state = reduceAiChatSessions(initial, { type: "begin", documentScopeKey: scope, owner, question: "😀".repeat(10000) });
  expect(state.sessions[0].chat.messages).toHaveLength(2);
  state = reduceAiChatSessions(initial, { type: "begin", documentScopeKey: scope, owner, question: "😀".repeat(10001) });
  expect(state.sessions[0].chat.messages).toHaveLength(0);
});
test("reserves two history messages and rejects response overflow", () => {
  let state = reduceAiChatSessions(createAiChatSessions(scope), add("one", "index.md"));
  for (let n = 1; n <= 100; n++) {
    const owner = { documentScopeKey: scope, sessionId: "one", generation: n, requestId: String(n) };
    state = reduceAiChatSessions(state, { type: "begin", documentScopeKey: scope, owner, question: "q" });
    state = reduceAiChatSessions(state, { type: "complete", documentScopeKey: scope, owner, content: "a" });
  }
  const owner = { documentScopeKey: scope, sessionId: "one", generation: 101, requestId: "101" };
  state = reduceAiChatSessions(state, { type: "begin", documentScopeKey: scope, owner, question: "q" });
  expect(state.sessions[0].chat.messages).toHaveLength(200);
  expect(state.sessions[0].owner).toBeUndefined();
  state = reduceAiChatSessions(state, { type: "clear", documentScopeKey: scope, sessionId: "one" });
  const nextOwner = { ...owner, generation: state.sessions[0].generation + 1 };
  state = reduceAiChatSessions(state, { type: "begin", documentScopeKey: scope, owner: nextOwner, question: "q" });
  state = reduceAiChatSessions(state, { type: "complete", documentScopeKey: scope, owner: nextOwner, content: "x".repeat(65537) });
  expect(state.sessions[0].chat.messages[1].status).toBe("failed");
});


test("total retention protects existing drafts and leaves clear/delete available", () => {
  let state = createAiChatSessions(scope);
  for (let n = 0; n < 9; n++) {
    state = reduceAiChatSessions(state, add(String(n), "index.md"));
    state = reduceAiChatSessions(state, { type: "draft", documentScopeKey: scope, sessionId: String(n), value: "x".repeat(1024 * 1024) });
  }
  expect(state.sessions[8].draft.length).toBe(0);
  expect(state.sessions[0].draft.length).toBe(1024 * 1024);
  state = reduceAiChatSessions(state, { type: "clear", documentScopeKey: scope, sessionId: "0" });
  state = reduceAiChatSessions(state, { type: "delete", documentScopeKey: scope, sessionId: "1" });
  expect(state.sessions[0].draft).toBe("");
  expect(state.sessions).toHaveLength(8);
});
