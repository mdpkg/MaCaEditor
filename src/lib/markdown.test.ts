import { describe, expect, test } from "vitest";
import {
  insertMarkdownBlock,
  insertMarkdownImages,
  isMarkdownPath,
  relativePackagePath,
  resolvePackagePath,
} from "./markdown";

describe("isMarkdownPath", () => {
  test.each(["README.md", "docs/guide.markdown", "NOTES.MD"])(
    "accepts Markdown file %s",
    (path) => expect(isMarkdownPath(path)).toBe(true),
  );

  test.each(["diagrams/math.tex", "diagrams/figure.svg", "notes.txt"])(
    "rejects non-Markdown file %s",
    (path) => expect(isMarkdownPath(path)).toBe(false),
  );
});

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

  test("wraps an image path containing spaces as a CommonMark destination", () => {
    const result = insertMarkdownImages(
      "", null, "README.md", ["images/スクリーンショット 2022.png"],
    );
    expect(result.content).toBe(
      "![スクリーンショット 2022](<images/スクリーンショット 2022.png>)",
    );
  });
});

describe("Markdown block insertion", () => {
  test("inserts a table at the cursor with surrounding line breaks", () => {
    const table = "|  |  |\n| --- | --- |\n|  |  |\n|  |  |";
    const result = insertMarkdownBlock("beforeafter", 6, table);
    expect(result.content).toBe(`before\n${table}\nafter`);
    expect(result.cursor).toBe(`before\n${table}`.length);
  });

  test("appends a block when no cursor is available", () => {
    const result = insertMarkdownBlock("# Title", null, "table");
    expect(result.content).toBe("# Title\ntable");
  });
});
