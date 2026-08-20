import { describe, expect, test } from "vitest";
import { insertMarkdownImages, relativePackagePath, resolvePackagePath } from "./markdown";

describe("resolvePackagePath", () => {
  test("resolves relative image path", () => {
    expect(resolvePackagePath("", "images/screenshot.png")).toBe(
      "images/screenshot.png",
    );
  });

  test("resolves relative path from subdirectory", () => {
    expect(resolvePackagePath("docs", "images/screenshot.png")).toBe(
      "docs/images/screenshot.png",
    );
  });

  test("rejects parent directory traversal", () => {
    expect(resolvePackagePath("", "../../secret.png")).toBeNull();
  });

  test("resolves parent segments that remain inside the package", () => {
    expect(resolvePackagePath("docs", "../images/a.png")).toBe("images/a.png");
  });

  test("rejects absolute path", () => {
    expect(resolvePackagePath("", "/etc/passwd")).toBeNull();
  });

  test("accepts leading dot slash", () => {
    expect(resolvePackagePath("", "./images/a.png")).toBe("images/a.png");
  });

  test("normalizes backslash separators", () => {
    expect(resolvePackagePath("", "images\\a.png")).toBe("images/a.png");
  });
});

describe("Markdown image insertion", () => {
  test("inserts at the cursor", () => {
    const result = insertMarkdownImages("beforeafter", 6, "README.md", ["images/photo.png"]);
    expect(result.content).toBe("before\n![photo](images/photo.png)\nafter");
  });

  test("appends when no cursor is available", () => {
    const result = insertMarkdownImages("# Title", null, "README.md", ["images/a.jpg"]);
    expect(result.content).toBe("# Title\n![a](images/a.jpg)");
  });

  test("creates paths relative to nested Markdown files", () => {
    expect(relativePackagePath("docs/guide.md", "images/a.png")).toBe("../images/a.png");
  });

  test("inserts multiple image links", () => {
    const result = insertMarkdownImages("", null, "README.md", ["images/a.png", "images/b.jpg"]);
    expect(result.content).toBe("![a](images/a.png)\n![b](images/b.jpg)");
  });
});
