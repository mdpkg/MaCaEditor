import { describe, expect, test } from "vitest";
import type { DocumentState } from "./document";
import { applyDocumentOperation, createDocumentHistory, redoDocumentOperation, undoDocumentOperation } from "./documentHistory";

const initial = { entrypoint: "index.md", dirty: false } as DocumentState;
const moved = { entrypoint: "docs/index.md", dirty: true } as DocumentState;

describe("document operation history", () => {
  test("undoes and redoes structural document changes", () => {
    const changed = applyDocumentOperation(createDocumentHistory(initial), moved, "Move index.md");
    const undone = undoDocumentOperation(changed);
    expect(undone.present).toBe(initial);
    expect(undone.redo).toHaveLength(1);
    const redone = redoDocumentOperation(undone);
    expect(redone.present).toBe(moved);
    expect(redone.undo).toHaveLength(1);
  });

  test("clears redo history after a new operation", () => {
    const changed = applyDocumentOperation(createDocumentHistory(initial), moved, "Move");
    const undone = undoDocumentOperation(changed);
    const renamed = { ...initial, entrypoint: "home.md" };
    expect(applyDocumentOperation(undone, renamed, "Rename").redo).toEqual([]);
  });
});
