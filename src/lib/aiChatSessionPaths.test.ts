import { expect, test } from "vitest";
import { createAiChatSessions, reduceAiChatSessions, retainedChatBytes } from "./aiChatSessions";
const documentScopeKey = "doc";
function initial() { return reduceAiChatSessions(createAiChatSessions(documentScopeKey), { type: "add", documentScopeKey, sessionId: "session", path: "folder/index.md" }); }

test("successful folder move and its inverse follow the same target", () => {
  let state = initial();
  state = reduceAiChatSessions(state, { type: "paths", documentScopeKey, changes: [{ from: "folder", to: "renamed" }] });
  expect(state.sessions[0].path).toBe("renamed/index.md");
  state = reduceAiChatSessions(state, { type: "paths", documentScopeKey, changes: [{ from: "renamed", to: "folder" }] });
  expect(state.sessions[0].path).toBe("folder/index.md");
  expect(state.sessions[0].available).toBe(true);
});
test("deletion permanently detaches even after same-path restoration and later moves", () => {
  let state = initial();
  state = reduceAiChatSessions(state, { type: "paths", documentScopeKey, changes: [{ from: "folder" }] });
  expect(state.sessions[0].available).toBe(false);
  state = reduceAiChatSessions(state, { type: "paths", documentScopeKey, changes: [{ from: "folder", to: "restored" }] });
  expect(state.sessions[0].available).toBe(false);
  expect(state.sessions[0].path).toBe("folder/index.md");
});
test("moving a different prefix does not affect the session", () => {
  const state = initial();
  expect(reduceAiChatSessions(state, { type: "paths", documentScopeKey, changes: [{ from: "fold", to: "elsewhere" }] })).toBe(state);
});


test("a move at the retention limit detaches instead of keeping an available obsolete path", () => {
  let state = initial();
  for (let n = 0; n < 8; n++) state = reduceAiChatSessions(state, { type: "add", documentScopeKey, sessionId: String(n), path: "other.md" });
  for (let n = 0; n < 7; n++) state = reduceAiChatSessions(state, { type: "draft", documentScopeKey, sessionId: String(n), value: "x".repeat(1024 * 1024) });
  state = reduceAiChatSessions(state, { type: "draft", documentScopeKey, sessionId: "7", value: "x".repeat(8 * 1024 * 1024 - retainedChatBytes(state)) });
  state = reduceAiChatSessions(state, { type: "paths", documentScopeKey, changes: [{ from: "folder", to: "a-longer-folder-name" }] });
  expect(state.sessions[0].available).toBe(false);
  expect(retainedChatBytes(state) <= 8 * 1024 * 1024).toBe(true);
});
