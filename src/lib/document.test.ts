import { describe, expect, test } from "vitest";
import type { PackageInfo } from "../types";
import {
  addDirectory, addMarkdown, createDocumentState, createFolderDocumentState, deletePath,
  markSaved, movePath, resourceDirectoryForMarkdown, setEntrypoint, toFolderSaveRequest, toSaveRequest, updateFileContent,
} from "./document";

const info: PackageInfo = {
  manifest: { format: "mdpkg", version: "1.0", entrypoint: "README.md", title: "T" },
  entrypoint: "README.md",
  files: [
    { path: "README.md", is_text: true, content: "# Hello", base64: null },
    { path: "manifest.json", is_text: true, content: "{}", base64: null },
  ],
};

describe("document state", () => {
  test("creates clean state", () => {
    const state = createDocumentState(info, "test.mdpkg");
    expect(state.dirty).toBe(false);
    expect(state.path).toBe("test.mdpkg");
    expect(state.origin).toEqual({ kind: "package", path: "test.mdpkg" });
  });

  test("creates Folder origin and baseline paths", () => {
    const state = createFolderDocumentState(info, "C:/docs/example");
    expect(state.origin).toEqual({ kind: "folder", path: "C:/docs/example" });
    expect(toFolderSaveRequest(state).original_paths).toEqual(["README.md", "manifest.json"]);
  });

  test("marks dirty on update", () => {
    const state = createDocumentState(info, "test.mdpkg");
    const updated = updateFileContent(state, "README.md", "# Updated");
    expect(updated.dirty).toBe(true);
  });

  test("updates file content", () => {
    const state = createDocumentState(info, "test.mdpkg");
    const updated = updateFileContent(state, "README.md", "# Updated");
    const readme = updated.files.find((f) => f.path === "README.md");
    expect(readme?.content).toBe("# Updated");
  });

  test("builds save request", () => {
    const state = createDocumentState(info, "test.mdpkg");
    const req = toSaveRequest(state);
    expect(req.path).toBe("test.mdpkg");
    expect(req.files.length).toBe(2);
    expect(req.manifest.version).toBe("2.0");
    expect(req.manifest.entrypoint).toBe("README.md");
  });

  test("keeps the in-memory manifest at v2 after saving a v1 document", () => {
    expect(markSaved(createDocumentState(info, "test.mdpkg")).manifest.version).toBe("2.0");
  });
});

describe("document structure", () => {
  test("places resources beside the markdown that links to them", () => {
    expect(resourceDirectoryForMarkdown("guides/start.md", "images")).toBe("guides/images");
    expect(resourceDirectoryForMarkdown("index.md", "diagrams")).toBe("diagrams");
  });

  test("adds transient folders and markdown files", () => {
    const current = createDocumentState(info, "test.mdpkg");
    const withFolder = addDirectory(current, "guides");
    const withMarkdown = addMarkdown(withFolder, "guides/start.md", "# Start\n");
    expect(withMarkdown.directories).toContain("guides");
    expect(withMarkdown.files.find((file) => file.path === "guides/start.md")?.content).toBe("# Start\n");
    expect(toSaveRequest(withFolder).files.every((file) => file.path !== "guides/")).toBe(true);
  });

  test("rejects file-directory collisions", () => {
    const current = addMarkdown(createDocumentState(info, "test.mdpkg"), "guides.md", "# File");
    expect(() => addMarkdown(current, "guides.md/start.md", "# Start")).toThrow(/exists/i);
    expect(() => addDirectory(current, "guides.md/drafts")).toThrow(/exists/i);
  });

  test("does not merge a move into an existing directory", () => {
    const current = addDirectory(addDirectory(createDocumentState(info, "test.mdpkg"), "one"), "two");
    expect(() => movePath(current, "one", "two")).toThrow(/exists/i);
  });

  test("moves a folder and rewrites markdown links while updating manifest paths", () => {
    const current = createDocumentState({
      manifest: {
        format: "mdpkg", version: "2.0", entrypoint: "docs/start.md",
        resources: [{ type: "plantuml", source: "docs/diagrams/a.puml", rendered: "docs/diagrams/a.svg" }],
      },
      entrypoint: "docs/start.md",
      files: [
        { path: "docs/start.md", is_text: true, content: "![A](diagrams/a.svg)", base64: null },
        { path: "docs/diagrams/a.puml", is_text: true, content: "@startuml\n@enduml", base64: null },
        { path: "docs/diagrams/a.svg", is_text: true, content: "<svg/>", base64: null },
      ],
    }, "test.mdpkg");
    const moved = movePath(current, "docs", "guide");
    expect(moved.entrypoint).toBe("guide/start.md");
    expect(moved.manifest.entrypoint).toBe("guide/start.md");
    expect((moved.manifest.resources as Array<{ source: string }>)[0].source).toBe("guide/diagrams/a.puml");
    expect(moved.files.find((file) => file.path === "guide/start.md")?.content).toBe("![A](diagrams/a.svg)");
  });

  test("updates links when only their target is moved", () => {
    const current = addMarkdown(createDocumentState(info, "test.mdpkg"), "guide.md", "[Notes](docs/notes.md)");
    const withTarget = addMarkdown(current, "docs/notes.md", "# Notes");
    const moved = movePath(withTarget, "docs/notes.md", "reference/notes.md");
    expect(moved.files.find((file) => file.path === "guide.md")?.content).toBe("[Notes](reference/notes.md)");
  });

  test("recalculates relative links when the markdown file itself is moved", () => {
    const current = addMarkdown(createDocumentState(info, "test.mdpkg"), "docs/guide.md", "[Home](../README.md)");
    const moved = movePath(current, "docs/guide.md", "guides/nested/guide.md");
    expect(moved.files.find((file) => file.path === "guides/nested/guide.md")?.content)
      .toBe("[Home](../../README.md)");
  });

  test("does not rewrite external URLs or document anchors", () => {
    const current = addMarkdown(createDocumentState(info, "test.mdpkg"), "docs/guide.md",
      "[Web](https://example.com) [Section](#section)");
    const moved = movePath(current, "docs/guide.md", "guide.md");
    expect(moved.files.find((file) => file.path === "guide.md")?.content)
      .toBe("[Web](https://example.com) [Section](#section)");
  });

  test("rewrites reference definitions but leaves link-shaped code unchanged", () => {
    const current = addMarkdown(createDocumentState(info, "test.mdpkg"), "guide.md", [
      "[Notes][notes]",
      "",
      "[notes]: docs/notes.md \"Notes\"",
      "",
      "`[Example](docs/notes.md)`",
    ].join("\n"));
    const withTarget = addMarkdown(current, "docs/notes.md", "# Notes");
    const moved = movePath(withTarget, "docs/notes.md", "reference/notes.md");
    expect(moved.files.find((file) => file.path === "guide.md")?.content).toBe([
      "[Notes][notes]",
      "",
      "[notes]: reference/notes.md \"Notes\"",
      "",
      "`[Example](docs/notes.md)`",
    ].join("\n"));
  });

  test("requires another entrypoint before deleting the current one", () => {
    const current = createDocumentState(info, "test.mdpkg");
    expect(() => deletePath(current, "README.md")).toThrow(/entrypoint/i);
  });

  test("sets an existing markdown file as entrypoint", () => {
    const current = addMarkdown(createDocumentState(info, "test.mdpkg"), "guide.md", "# Guide");
    const updated = setEntrypoint(current, "guide.md");
    expect(updated.entrypoint).toBe("guide.md");
    expect(updated.manifest.entrypoint).toBe("guide.md");
  });

  test("deletes a resource and its manifest record without rewriting markdown", () => {
    const current = createDocumentState({
      manifest: {
        format: "mdpkg", version: "2.0", entrypoint: "index.md",
        resources: [{ type: "plantuml", source: "diagrams/a.puml", rendered: "diagrams/a.svg" }],
      },
      entrypoint: "index.md",
      files: [
        { path: "index.md", is_text: true, content: "![A](diagrams/a.svg)", base64: null },
        { path: "diagrams/a.puml", is_text: true, content: "", base64: null },
        { path: "diagrams/a.svg", is_text: true, content: "", base64: null },
      ],
    }, "test.mdpkg");
    const deleted = deletePath(current, "diagrams/a.svg");
    expect(deleted.files.some((file) => file.path === "diagrams/a.svg")).toBe(false);
    expect(deleted.manifest.resources).toEqual([]);
    expect(deleted.files.find((file) => file.path === "index.md")?.content).toBe("![A](diagrams/a.svg)");
  });
});
