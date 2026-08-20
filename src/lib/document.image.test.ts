import { describe, expect, it } from "vitest";
import { addImage, imageMediaType, type DocumentState } from "./document";

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
