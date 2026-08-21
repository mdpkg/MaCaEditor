import { describe, expect, it } from "vitest";
// @ts-expect-error Node types are intentionally not part of the application build.
import { readFileSync } from "node:fs";
// @ts-expect-error Node types are intentionally not part of the application build.
import { resolve } from "node:path";

declare const process: { cwd(): string };
const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

describe("attached Markdown preview theme", () => {
  it("scopes the GitHub Markdown styles to the preview", () => {
    expect(styles).toContain(".markdown-preview {");
    expect(styles).toContain("font-family: Helvetica, arial, sans-serif;");
    expect(styles).toContain(".markdown-preview table td,");
    expect(styles).toContain(".markdown-preview pre {");
    expect(styles).not.toContain("\nbody {\n  font-family: Helvetica");
  });
});

describe("image sizing styles", () => {
  it.each([".markdown-preview img", ".drawing-image svg", ".binary-view img"])(
    "preserves aspect ratio for %s",
    (selector) => {
      const start = styles.indexOf(`${selector} {`);
      const block = start >= 0 ? styles.slice(start, styles.indexOf("}", start)) : "";
      expect(block).toContain("max-width: 100%");
      expect(block).toContain("max-height: 70vh");
      expect(block).toContain("width: auto");
      expect(block).toContain("height: auto");
      expect(block).toContain("object-fit: contain");
    },
  );
});

describe("drawing sidebar layout", () => {
  it("splits the drawing sidebar between the file tree and properties", () => {
    const treeStart = styles.indexOf(".sidebar-with-properties .sidebar-tree {");
    const treeBlock = treeStart >= 0 ? styles.slice(treeStart, styles.indexOf("}", treeStart)) : "";
    const propertiesStart = styles.indexOf(".sidebar-properties {");
    const propertiesBlock = propertiesStart >= 0
      ? styles.slice(propertiesStart, styles.indexOf("}", propertiesStart))
      : "";

    expect(treeBlock).toContain("flex: 0 0 50%");
    expect(propertiesBlock).toContain("flex: 1");
    expect(propertiesBlock).toContain("overflow: auto");
  });
});

describe("drawing canvas interaction", () => {
  it("disables native text selection inside the SVG canvas", () => {
    const start = styles.indexOf(".drawing-canvas {");
    const block = start >= 0 ? styles.slice(start, styles.indexOf("}", start)) : "";

    expect(block).toContain("user-select: none");
  });
});

describe("drawing toolbar dropdowns", () => {
  it("does not change a dropdown color when its tool is active", () => {
    expect(styles).not.toContain(".drawing-toolbar select.active");
  });
});

describe("drawing context menu", () => {
  it("keeps scrolling available while hiding its scrollbar", () => {
    const start = styles.indexOf(".drawing-context-menu {");
    const block = start >= 0 ? styles.slice(start, styles.indexOf("}", start)) : "";

    expect(block).toContain("overflow: auto");
    expect(block).toContain("scrollbar-width: none");
    expect(styles).toContain(".drawing-context-menu::-webkit-scrollbar");
    expect(styles).toContain("display: none");
  });
});

describe("print styles", () => {
  it("prints only the Markdown preview", () => {
    const printStyles = styles.slice(styles.indexOf("@media print"));
    expect(printStyles).toContain(".toolbar,");
    expect(printStyles).toContain(".sidebar,");
    expect(printStyles).toContain(".markdown-editor,");
    expect(printStyles).toContain("display: none !important");
    expect(printStyles).toContain(".markdown-preview {");
  });
});
