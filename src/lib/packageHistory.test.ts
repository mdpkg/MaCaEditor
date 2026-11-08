import { expect, test } from "vitest";
import { createDocumentState, movePath } from "./document";
import { applyPackageHistoryEntry, fileHistoryEntry } from "./packageHistory";

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

  expect(() => applyPackageHistoryEntry(conflicting, entry, "undo")).toThrow();
  expect(conflicting.files.map(({ path, content }) => [path, content])).toEqual([
    ["index.md", "[Guide](guide.md)"],
    ["guide.md", "[Home](index.md)"],
    ["docs/guide.md", "Another file"],
  ]);
  expect(applyPackageHistoryEntry(after, entry, "undo").files).toEqual(before.files);
});
