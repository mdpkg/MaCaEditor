import { describe, expect, test } from "vitest";
import type { FileInfo } from "../types";
import { searchPackage } from "./packageSearch";

const files: FileInfo[] = [
  { path: "index.md", is_text: true, content: "# Welcome\nRead the [Guide](docs/guide.md).", base64: null },
  { path: "docs/guide.md", is_text: true, content: "# Installation Guide\nInstall the app.", base64: null },
  { path: "images/logo.png", is_text: false, content: null, base64: "AAAA" },
];

describe("searchPackage", () => {
  test("searches file names, content, headings, and link destinations", () => {
    expect(searchPackage(files, "guide", "filename").map((item) => item.path)).toEqual(["docs/guide.md"]);
    expect(searchPackage(files, "install", "content")[0]).toMatchObject({ path: "docs/guide.md", line: 1 });
    expect(searchPackage(files, "installation", "heading")[0]).toMatchObject({ path: "docs/guide.md", line: 1 });
    expect(searchPackage(files, "docs/guide", "link")[0]).toMatchObject({ path: "index.md", line: 2 });
  });

  test("searches backlinks by exact target path", () => {
    expect(searchPackage(files, "docs/guide.md", "backlink")).toEqual([expect.objectContaining({
      path: "index.md", line: 2, kind: "backlink",
    })]);
  });
});
