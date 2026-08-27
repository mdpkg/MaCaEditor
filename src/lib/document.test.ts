import { describe, expect, test } from "vitest";
import type { PackageInfo } from "../types";
import {
  addDirectory, addMarkdown, createDocumentState, createFolderDocumentState, deletePath,
  markSaved, movePath, pathReferenceCount, resourceDirectoryForMarkdown, setEntrypoint, toFolderSaveRequest, toSaveRequest, updateFileContent, updateManifestMetadata,
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

  test("counts Markdown references affected by deleting a path", () => {
    const current = addMarkdown(createDocumentState(info, "test.mdpkg"), "guide.md",
      "[One](docs/a.md) ![Two](docs/images/a.png) [Web](https://example.com)");
    expect(pathReferenceCount(current, "docs")).toBe(2);
  });

  test("sets an existing markdown file as entrypoint", () => {
    const current = addMarkdown(createDocumentState(info, "test.mdpkg"), "guide.md", "# Guide");
    const updated = setEntrypoint(current, "guide.md");
    expect(updated.entrypoint).toBe("guide.md");
    expect(updated.manifest.entrypoint).toBe("guide.md");
  });

  test("updates manifest metadata while preserving unknown fields", () => {
    const current = addMarkdown(createDocumentState(info, "test.mdpkg"), "guide.md", "# Guide");
    const updated = updateManifestMetadata(current, {
      entrypoint: "guide.md",
      description: "Guide",
      resources: [{ type: "custom", source: "README.md", rendered: "README.md" }],
    });
    expect(updated.manifest).toMatchObject({
      title: "T", entrypoint: "guide.md", description: "Guide",
      resources: [{ type: "custom", source: "README.md", rendered: "README.md" }],
    });
    expect(updated.entrypoint).toBe("guide.md");
    expect(updated.dirty).toBe(true);
  });

  test("marks rendered output stale when its source changes and clears it when regenerated", () => {
    const current = createDocumentState({
      manifest: { format: "mdpkg", version: "2.0", entrypoint: "index.md", resources: [
        { type: "custom", source: "diagrams/a.txt", rendered: "diagrams/a.svg" },
      ] }, entrypoint: "index.md", files: [
        { path: "index.md", is_text: true, content: "# Index", base64: null },
        { path: "diagrams/a.txt", is_text: true, content: "source", base64: null },
        { path: "diagrams/a.svg", is_text: true, content: "<svg/>", base64: null },
      ],
    }, "test.mdpkg");
    const edited = updateFileContent(current, "diagrams/a.txt", "changed");
    expect(edited.staleResources).toEqual(["diagrams/a.svg"]);
    expect(updateFileContent(edited, "diagrams/a.svg", "<svg>new</svg>").staleResources).toEqual([]);
  });

  test("rejects manifest resources whose files do not exist", () => {
    const current = createDocumentState(info, "test.mdpkg");
    expect(() => updateManifestMetadata(current, {
      entrypoint: "README.md", description: "",
      resources: [{ type: "plantuml", source: "missing.puml", rendered: "missing.svg" }],
    })).toThrow(/does not exist/i);
  });

  test("rejects a non-Markdown manifest entrypoint", () => {
    const current = createDocumentState(info, "test.mdpkg");
    expect(() => updateManifestMetadata(current, {
      entrypoint: "images/a.png", description: "", resources: [],
    })).toThrow(/entrypoint/i);
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

  test("moves both files when one member of a resource pair is moved", () => {
    const current = createDocumentState({
      manifest: { format: "mdpkg", version: "2.0", entrypoint: "index.md", resources: [
        { type: "plantuml", source: "diagrams/a.puml", rendered: "diagrams/a.svg" },
      ] },
      entrypoint: "index.md",
      files: [
        { path: "index.md", is_text: true, content: "![A](diagrams/a.svg)", base64: null },
        { path: "diagrams/a.puml", is_text: true, content: "@startuml", base64: null },
        { path: "diagrams/a.svg", is_text: true, content: "<svg/>", base64: null },
      ],
    }, "test.mdpkg");
    const moved = movePath(current, "diagrams/a.puml", "architecture/a.puml");
    expect(moved.files.map((file) => file.path)).toEqual([
      "index.md", "architecture/a.puml", "architecture/a.svg",
    ]);
    expect(moved.files[0].content).toBe("![A](architecture/a.svg)");
  });

  test("deletes both files when one member of a resource pair is deleted", () => {
    const current = createDocumentState({
      manifest: { format: "mdpkg", version: "2.0", entrypoint: "index.md", resources: [
        { type: "mermaid", source: "diagrams/a.mmd", rendered: "diagrams/a.svg" },
      ] },
      entrypoint: "index.md",
      files: [
        { path: "index.md", is_text: true, content: "![A](diagrams/a.svg)", base64: null },
        { path: "diagrams/a.mmd", is_text: true, content: "flowchart LR", base64: null },
        { path: "diagrams/a.svg", is_text: true, content: "<svg/>", base64: null },
      ],
    }, "test.mdpkg");
    const deleted = deletePath(current, "diagrams/a.mmd");
    expect(deleted.files.map((file) => file.path)).toEqual(["index.md"]);
    expect(deleted.manifest.resources).toEqual([]);
  });
});
