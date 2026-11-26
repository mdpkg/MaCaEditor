import { expect, test } from "vitest";
import { createDocumentState, movePath } from "./document";
import { fileHistoryEntry } from "./editHistory";
import { createAiChatSessions, reduceAiChatSessions } from "./aiChatSessions";
import { chatHistoryPathChanges } from "./chatFileChanges";
const before = createDocumentState({ entrypoint: "index.md", manifest: { version: "2.0", entrypoint: "index.md" }, files: [
  { path: "index.md", content: "home", is_text: true, base64: null },
  { path: "docs/guide.md", content: "guide", is_text: true, base64: null },
] }, "book.mdpkg");
const entry = fileHistoryEntry(before, movePath(before, "docs/guide.md", "guide.md"), "move")!;
const add = (path: string) => reduceAiChatSessions(createAiChatSessions("doc"), { type: "add", documentScopeKey: "doc", sessionId: "s", path });
test("recorded move metadata follows Redo and Undo without inspecting matching contents", () => {
  const moves = [{ from: "docs/guide.md", to: "guide.md" }];
  let state = add("docs/guide.md");
  state = reduceAiChatSessions(state, { type: "paths", documentScopeKey: "doc", changes: chatHistoryPathChanges(entry, "redo", moves) });
  expect(state.sessions[0].path).toBe("guide.md");
  state = reduceAiChatSessions(state, { type: "paths", documentScopeKey: "doc", changes: chatHistoryPathChanges(entry, "undo", moves) });
  expect(state.sessions[0].path).toBe("docs/guide.md");
  expect(state.sessions[0].available).toBe(true);
});
test.each(["undo", "redo"] as const)("history without identity metadata detaches on %s", (direction) => {
  let state = add(direction === "undo" ? "guide.md" : "docs/guide.md");
  state = reduceAiChatSessions(state, { type: "paths", documentScopeKey: "doc", changes: chatHistoryPathChanges(entry, direction) });
  expect(state.sessions[0].available).toBe(false);
});
