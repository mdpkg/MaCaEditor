import { describe, expect, test } from "vitest";
import type { FileInfo } from "../types";
import { findBacklinks, resolveMarkdownLink } from "./packageNavigation";

const files: FileInfo[] = [
  { path: "index.md", is_text: true, content: "[Guide](docs/guide.md)", base64: null },
  { path: "docs/guide.md", is_text: true, content: "[Home](../index.md)\n![Logo](images/logo.png)", base64: null },
  { path: "docs/images/logo.png", is_text: false, content: null, base64: "AAAA" },
];

describe("package navigation", () => {
  test("resolves internal links and rejects external or escaping links", () => {
    expect(resolveMarkdownLink("docs/guide.md", "../index.md", files)).toBe("index.md");
    expect(resolveMarkdownLink("index.md", "https://example.com", files)).toBeNull();
    expect(resolveMarkdownLink("index.md", "../outside.md", files)).toBeNull();
    expect(resolveMarkdownLink("index.md", "missing.md", files)).toBeNull();
  });

  test("finds Markdown files and lines that reference a package path", () => {
    expect(findBacklinks("index.md", files)).toEqual([{ path: "docs/guide.md", line: 1, offset: 7 }]);
    expect(findBacklinks("docs/images/logo.png", files)).toEqual([{ path: "docs/guide.md", line: 2, offset: 28 }]);
  });
});
