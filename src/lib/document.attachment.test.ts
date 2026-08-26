import { describe, expect, it } from "vitest";
import {
  addAttachment,
  deleteAsset,
  isDeletableAsset,
  renameAsset,
  type DocumentState,
} from "./document";

function state(paths: string[] = []): DocumentState {
  return {
    path: "test.mdpkg",
    origin: { kind: "package", path: "test.mdpkg" },
    originalPaths: [],
    entrypoint: "README.md",
    manifest: {},
    dirty: false,
    files: paths.map((path) => ({ path, is_text: false, content: null, base64: "old" })),
  };
}

describe("attachment assets", () => {
  it("adds arbitrary files below attachments and marks the document dirty", () => {
    const added = addAttachment(state(), "仕様書.pdf", "data");

    expect(added.path).toBe("attachments/仕様書.pdf");
    expect(added.state.dirty).toBe(true);
    expect(added.state.files[0]).toMatchObject({
      path: "attachments/仕様書.pdf",
      is_text: false,
      base64: "data",
    });
  });

  it("adds an attachment beside a nested markdown document", () => {
    const added = addAttachment(state(), "notes.txt", "data", "guides/start.md");
    expect(added.path).toBe("guides/attachments/notes.txt");
  });

  it("keeps duplicate names unique case-insensitively", () => {
    const added = addAttachment(
      state(["attachments/Report.PDF", "attachments/report-2.pdf"]),
      "report.pdf",
      "data",
    );

    expect(added.path).toBe("attachments/report-3.pdf");
  });

  it("renames an attachment and updates Markdown links", () => {
    const current = state(["attachments/仕様書.pdf"]);
    current.files.unshift({
      path: "README.md",
      is_text: true,
      content: "[仕様書](attachments/仕様書.pdf)",
      base64: null,
    });

    const renamed = renameAsset(current, "attachments/仕様書.pdf", "最終仕様書");

    expect(renamed.path).toBe("attachments/最終仕様書.pdf");
    expect(renamed.state.files[0].content).toBe("[仕様書](attachments/最終仕様書.pdf)");
  });

  it("deletes an attachment and its Markdown links", () => {
    const current = state(["attachments/仕様書.pdf"]);
    current.files.unshift({
      path: "README.md",
      is_text: true,
      content: "before\n[仕様書](attachments/仕様書.pdf)\nafter",
      base64: null,
    });

    expect(isDeletableAsset(current, "attachments/仕様書.pdf")).toBe(true);
    const deleted = deleteAsset(current, "attachments/仕様書.pdf");
    expect(deleted.files.map((file) => file.path)).toEqual(["README.md"]);
    expect(deleted.files[0].content).toBe("before\n\nafter");
  });
});
