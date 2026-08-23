import { describe, expect, it } from "vitest";
import {
  addImage,
  deleteAsset,
  imageMediaType,
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

describe("image assets", () => {
  it("adds images below images and marks the document dirty", () => {
    const added = addImage(state(), "photo.jpg", "data");
    expect(added.path).toBe("images/photo.jpg");
    expect(added.state.dirty).toBe(true);
    expect(added.state.files[0].base64).toBe("data");
  });

  it("keeps duplicate names unique case-insensitively", () => {
    const added = addImage(state(["images/Photo.PNG", "images/photo-2.png"]), "photo.png", "data");
    expect(added.path).toBe("images/photo-3.png");
  });

  it("preserves Japanese image file names", () => {
    const added = addImage(state(), "設計図.png", "data");
    expect(added.path).toBe("images/設計図.png");
  });

  it("returns the correct media type", () => {
    expect(imageMediaType("images/a.jpeg")).toBe("image/jpeg");
    expect(imageMediaType("images/a.webp")).toBe("image/webp");
    expect(imageMediaType("images/a.png")).toBe("image/png");
  });
});

describe("asset rename", () => {
  it("renames an image and updates Markdown references", () => {
    const current = state(["images/写真.png"]);
    current.files.unshift({
      path: "docs/guide.md",
      is_text: true,
      content: "![写真](../images/写真.png)",
      base64: null,
    });
    const renamed = renameAsset(current, "images/写真.png", "完成図");
    expect(renamed.path).toBe("images/完成図.png");
    expect(renamed.state.files.some((file) => file.path === "images/完成図.png")).toBe(true);
    expect(renamed.state.files[0].content).toBe("![写真](../images/完成図.png)");
  });

  it("renames both diagram files, resources, and Markdown references", () => {
    const current = state(["diagrams/drawing-1.draw.json", "diagrams/drawing-1.svg"]);
    current.manifest = {
      resources: [{ source: "diagrams/drawing-1.draw.json", rendered: "diagrams/drawing-1.svg", type: "drawing" }],
    };
    current.files.unshift({
      path: "README.md",
      is_text: true,
      content: "![Drawing](diagrams/drawing-1.svg)",
      base64: null,
    });
    const renamed = renameAsset(current, "diagrams/drawing-1.draw.json", "構成図");
    expect(renamed.path).toBe("diagrams/構成図.draw.json");
    expect(renamed.state.files.map((file) => file.path)).toContain("diagrams/構成図.svg");
    expect(renamed.state.files[0].content).toBe("![Drawing](diagrams/構成図.svg)");
    expect(renamed.state.manifest.resources).toEqual([
      { source: "diagrams/構成図.draw.json", rendered: "diagrams/構成図.svg", type: "drawing" },
    ]);
  });

  it("renames PlantUML source and rendered files together", () => {
    const current = state(["diagrams/sequence.puml", "diagrams/sequence.svg"]);
    current.manifest = {
      resources: [{ source: "diagrams/sequence.puml", rendered: "diagrams/sequence.svg", type: "plantuml" }],
    };
    current.files.unshift({
      path: "README.md", is_text: true,
      content: "![Sequence](diagrams/sequence.svg)", base64: null,
    });

    const renamed = renameAsset(current, "diagrams/sequence.puml", "ログインシーケンス");

    expect(renamed.path).toBe("diagrams/ログインシーケンス.puml");
    expect(renamed.state.files.map((file) => file.path)).toContain("diagrams/ログインシーケンス.svg");
    expect(renamed.state.files[0].content).toBe("![Sequence](diagrams/ログインシーケンス.svg)");
  });

  it("renames Mermaid source and rendered files together", () => {
    const current = state(["diagrams/flow.mmd", "diagrams/flow.svg"]);
    current.manifest = {
      resources: [{ source: "diagrams/flow.mmd", rendered: "diagrams/flow.svg", type: "mermaid" }],
    };
    current.files.unshift({
      path: "README.md", is_text: true, content: "![Flow](diagrams/flow.svg)", base64: null,
    });
    const renamed = renameAsset(current, "diagrams/flow.mmd", "処理フロー");
    expect(renamed.path).toBe("diagrams/処理フロー.mmd");
    expect(renamed.state.files.map((file) => file.path)).toContain("diagrams/処理フロー.svg");
    expect(renamed.state.files[0].content).toBe("![Flow](diagrams/処理フロー.svg)");
  });

  it("rejects a name already used in the same folder", () => {
    expect(() => renameAsset(state(["images/a.png", "images/b.png"]), "images/a.png", "b"))
      .toThrow("already exists");
  });
});

describe("asset deletion", () => {
  it("deletes an image and its Markdown image references", () => {
    const current = state(["images/写真.png", "images/keep.png"]);
    current.files.unshift({
      path: "docs/guide.md",
      is_text: true,
      content: "before\n![写真](../images/写真.png)\nafter\n![keep](../images/keep.png)",
      base64: null,
    });

    const deleted = deleteAsset(current, "images/写真.png");

    expect(deleted.files.map((file) => file.path)).not.toContain("images/写真.png");
    expect(deleted.files[0].content).toBe("before\n\nafter\n![keep](../images/keep.png)");
    expect(deleted.dirty).toBe(true);
  });

  it.each(["diagrams/drawing-1.draw.json", "diagrams/drawing-1.svg"])(
    "deletes both drawing files and its resource when selecting %s",
    (selected) => {
      const current = state([
        "diagrams/drawing-1.draw.json",
        "diagrams/drawing-1.svg",
        "diagrams/keep.svg",
      ]);
      current.manifest = {
        resources: [
          { source: "diagrams/drawing-1.draw.json", rendered: "diagrams/drawing-1.svg", type: "drawing" },
          { source: "other.puml", rendered: "diagrams/keep.svg", type: "plantuml" },
        ],
      };

      const deleted = deleteAsset(current, selected);

      expect(deleted.files.map((file) => file.path)).toEqual(["diagrams/keep.svg"]);
      expect(deleted.manifest.resources).toEqual([
        { source: "other.puml", rendered: "diagrams/keep.svg", type: "plantuml" },
      ]);
    },
  );

  it.each(["diagrams/sequence.puml", "diagrams/sequence.svg"])(
    "deletes PlantUML source, rendered file, resource, and Markdown reference from %s",
    (selected) => {
      const current = state(["diagrams/sequence.puml", "diagrams/sequence.svg"]);
      current.manifest = {
        resources: [{ source: "diagrams/sequence.puml", rendered: "diagrams/sequence.svg", type: "plantuml" }],
      };
      current.files.unshift({
        path: "README.md", is_text: true,
        content: "before\n![Sequence](diagrams/sequence.svg)\nafter", base64: null,
      });

      const deleted = deleteAsset(current, selected);

      expect(deleted.files.map((file) => file.path)).toEqual(["README.md"]);
      expect(deleted.files[0].content).toBe("before\n\nafter");
      expect(deleted.manifest.resources).toEqual([]);
    },
  );

  it.each(["diagrams/flow.mmd", "diagrams/flow.svg"])(
    "deletes Mermaid source, rendered file, and resource from %s",
    (selected) => {
      const current = state(["diagrams/flow.mmd", "diagrams/flow.svg"]);
      current.manifest = {
        resources: [{ source: "diagrams/flow.mmd", rendered: "diagrams/flow.svg", type: "mermaid" }],
      };
      const deleted = deleteAsset(current, selected);
      expect(deleted.files).toEqual([]);
      expect(deleted.manifest.resources).toEqual([]);
    },
  );

  it.each(["diagrams/math-1.tex", "diagrams/math-1.svg"])(
    "deletes MathJax source, rendered file, and resource from %s",
    (selected) => {
      const current = state(["diagrams/math-1.tex", "diagrams/math-1.svg"]);
      current.manifest = {
        resources: [{ source: "diagrams/math-1.tex", rendered: "diagrams/math-1.svg", type: "mathjax" }],
      };
      const deleted = deleteAsset(current, selected);
      expect(deleted.files).toEqual([]);
      expect(deleted.manifest.resources).toEqual([]);
    },
  );

  it("only enables deletion for image and drawing assets", () => {
    const current = state(["README.md", "images/a.png", "diagrams/a.draw.json", "diagrams/a.svg"]);
    current.manifest = {
      resources: [{ source: "diagrams/a.draw.json", rendered: "diagrams/a.svg", type: "drawing" }],
    };

    expect(isDeletableAsset(current, "images/a.png")).toBe(true);
    expect(isDeletableAsset(current, "diagrams/a.svg")).toBe(true);
    expect(isDeletableAsset(current, "README.md")).toBe(false);
  });
});
