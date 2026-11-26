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
