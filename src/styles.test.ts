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

describe("Markdown preview media overlay", () => {
  it("fills the window and contains enlarged media without distortion", () => {
    const overlayStart = styles.indexOf(".preview-media-overlay {");
    const overlayBlock = overlayStart >= 0
      ? styles.slice(overlayStart, styles.indexOf("}", overlayStart))
      : "";
    const mediaStart = styles.indexOf(".preview-media-transform > img,");
    const mediaBlock = mediaStart >= 0
      ? styles.slice(mediaStart, styles.indexOf("}", mediaStart))
      : "";

    expect(overlayBlock).toContain("position: fixed");
    expect(overlayBlock).toContain("inset: 0");
    expect(mediaBlock).toContain("object-fit: contain");
    expect(styles).toContain(".preview-media-close {");
    expect(styles).toContain(".preview-media-content.dragging {");
    expect(styles).toContain("touch-action: none");
    expect(styles).toContain("will-change: transform");
  });
});

describe("Markdown preview diagram actions", () => {
  it("reveals the diagram Edit button on hover and keyboard focus", () => {
    expect(styles).toContain(".preview-diagram-edit {");
    expect(styles).toContain(".preview-diagram:hover .preview-diagram-edit,");
    expect(styles).toContain(".preview-diagram:focus-within .preview-diagram-edit {");
    expect(styles).toContain("pointer-events: none");
  });
});

describe("diagram editor preview cursor", () => {
  it("uses the zoom cursor for clickable diagram previews", () => {
    const start = styles.indexOf(".plantuml-preview,");
    const block = start >= 0 ? styles.slice(start, styles.indexOf("}", start)) : "";
    expect(block).toContain(".mermaid-preview,");
    expect(block).toContain(".mathjax-preview");
    expect(block).toContain("cursor: zoom-in");
  });
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

  describe("Markdown editor layout", () => {
  it("keeps the editor within the window and scrolls inside CodeMirror", () => {
    const documentStart = styles.indexOf(".document-area-editor {");
    const documentBlock = documentStart >= 0
      ? styles.slice(documentStart, styles.indexOf("}", documentStart))
      : "";
    const splitStart = styles.indexOf(".split-view {");
    const splitBlock = splitStart >= 0 ? styles.slice(splitStart, styles.indexOf("}", splitStart)) : "";
    const scrollerStart = styles.indexOf(".code-editor .cm-scroller {");
    const scrollerBlock = scrollerStart >= 0
      ? styles.slice(scrollerStart, styles.indexOf("}", scrollerStart))
      : "";

    expect(documentBlock).toContain("overflow: hidden");
    expect(splitBlock).toContain("grid-template-rows: minmax(0, 1fr)");
    expect(splitBlock).toContain("min-height: 0");
    expect(scrollerBlock).toContain("overflow: auto");
    expect(scrollerBlock).toContain("cursor: text");
  });

  it("styles Rspress containers and expandable details", () => {
    expect(styles).toContain(".markdown-preview .rspress-container {");
    expect(styles).toContain(".markdown-preview .rspress-container-tip {");
    expect(styles).toContain(".markdown-preview .rspress-container-details > summary {");
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
