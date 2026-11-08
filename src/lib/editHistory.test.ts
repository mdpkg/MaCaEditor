import { expect, test } from "vitest";
import { addAttachment, createDocumentState, deletePath, movePath, updateFileContent } from "./document";
import { captureEditCheckpoint, restoreEditCheckpoint } from "./editCheckpoint";
import { applyEditHistoryEntry, createEditHistory, fileHistoryEntry, recordEdit, reuseAttachmentPayload, textHistoryEntry } from "./editHistory";

test("rejects an occupied original path without partially undoing a move or its link edits", () => {
  const before = createDocumentState({
    entrypoint: "index.md",
    manifest: { version: "2.0", entrypoint: "index.md" },
    files: [
      { path: "index.md", content: "[Guide](docs/guide.md)", is_text: true, base64: null },
      { path: "docs/guide.md", content: "[Home](../index.md)", is_text: true, base64: null },
    ],
  }, "book.mdpkg");
  const after = movePath(before, "docs/guide.md", "guide.md");
  const entry = fileHistoryEntry(before, after, "Move guide")!;
  const conflicting = { ...after, files: [...after.files, { ...before.files[1], content: "Another file" }] };

  expect(() => applyEditHistoryEntry(conflicting, entry, "undo")).toThrow();
  expect(conflicting.files.map(({ path, content }) => [path, content])).toEqual([
    ["index.md", "[Guide](guide.md)"],
    ["guide.md", "[Home](index.md)"],
    ["docs/guide.md", "Another file"],
  ]);
  expect(applyEditHistoryEntry(after, entry, "undo").files).toEqual(before.files);
});

function documentWithText(content: string) {
  return createDocumentState({
    entrypoint: "index.md",
    manifest: { version: "2.0", entrypoint: "index.md" },
    files: [{ path: "index.md", content, is_text: true, base64: null }],
  }, "book.mdpkg");
}

test("replays an attachment deletion after restarting with a pending text redo", () => {
  const initial = documentWithText("Original");
  const added = addAttachment(initial, "shared.bin", "AQID");
  const deleted = deletePath(added.state, added.path);
  const edited = updateFileContent(deleted, initial.entrypoint, "Edited");
  const history = createEditHistory();
  recordEdit(history, fileHistoryEntry(initial, added.state, "Add attachment")!);
  recordEdit(history, fileHistoryEntry(added.state, deleted, "Delete attachment")!);
  recordEdit(history, textHistoryEntry(initial.entrypoint, "Original", "Edited", deleted.staleResources, edited.staleResources));
  history.cursor--;

  const restored = restoreEditCheckpoint(deleted, captureEditCheckpoint(deleted, history));
  const deletion = restored.history.entries[restored.history.cursor - 1];
  const undo = applyEditHistoryEntry(restored.state, deletion, "undo");
  expect(undo.files.find(({ path }) => path === added.path)?.base64).toBe("AQID");
  const redo = applyEditHistoryEntry(undo, deletion, "redo");
  expect(redo.files).toEqual(deleted.files);
  expect(applyEditHistoryEntry(redo, restored.history.entries[restored.history.cursor], "redo").files).toEqual(edited.files);
});

test("small history patches preserve the exact UTF-16 code units", () => {
  const prefix = "x".repeat(5000);
  const before = prefix + "\ud83d\ude00\r\n\ud800";
  const after = prefix + "\ud83d\ude42\n\udc00";
  const initial = documentWithText(before);
  const next = updateFileContent(initial, "index.md", after);
  const entry = textHistoryEntry("index.md", before, after, initial.staleResources, next.staleResources);
  expect(applyEditHistoryEntry(next, entry, "undo").files[0].content).toBe(before);
  expect(applyEditHistoryEntry(initial, entry, "redo").files[0].content).toBe(after);
});

test("large attachments with identical size and samples replay their own bytes", () => {
  const initial = documentWithText("Attachments");
  const history = createEditHistory();
  const first = "A".repeat(2 ** 20);
  const second = first.slice(0, 100) + "B" + first.slice(101);
  const addedFirst = addAttachment(initial, "first.bin", reuseAttachmentPayload(history, first), "index.md");
  recordEdit(history, fileHistoryEntry(initial, addedFirst.state, "Add first")!);
  const addedSecond = addAttachment(addedFirst.state, "second.bin", reuseAttachmentPayload(history, second), "index.md");
  const entry = fileHistoryEntry(addedFirst.state, addedSecond.state, "Add second")!;
  recordEdit(history, entry);

  const undone = applyEditHistoryEntry(addedSecond.state, entry, "undo");
  expect(undone.files.map((file) => file.base64)).toEqual([null, first]);
  expect(applyEditHistoryEntry(undone, entry, "redo").files.map((file) => file.base64)).toEqual([null, first, second]);
});
