import { describe, expect, it } from "vitest";
import { addImage, imageMediaType, renameAsset, type DocumentState } from "./document";

function state(paths: string[] = []): DocumentState {
  return {
    path: "test.mdpkg",
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

  it("rejects a name already used in the same folder", () => {
    expect(() => renameAsset(state(["images/a.png", "images/b.png"]), "images/a.png", "b"))
      .toThrow("already exists");
  });
});
