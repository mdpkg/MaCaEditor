import { describe, expect, test } from "vitest";
import type { DocumentState } from "../document";
import {
  DEFAULT_MATHJAX_SOURCE,
  addMathJaxToDocument,
  findMathJaxResourceByRendered,
  findMathJaxResourceBySource,
  saveMathJaxToDocument,
} from "./docIntegration";

function state(): DocumentState {
  return {
    path: "test.mdpkg",
    entrypoint: "README.md",
    files: [{ path: "README.md", is_text: true, content: "# Guide", base64: null }],
    manifest: { resources: [] },
    dirty: false,
  };
}

describe("MathJax document integration", () => {
  test("adds TeX source, SVG, resource, and Markdown reference", () => {
    const added = addMathJaxToDocument(state(), DEFAULT_MATHJAX_SOURCE, "<svg>first</svg>", "MathJax");
    expect(added.sourcePath).toBe("diagrams/math-1.tex");
    expect(added.svgPath).toBe("diagrams/math-1.svg");
    expect(added.state.manifest.resources).toContainEqual({
      source: added.sourcePath, rendered: added.svgPath, type: "mathjax",
    });
    expect(added.state.files[0].content).toContain("![MathJax](diagrams/math-1.svg)");
  });

  test("uses the cursor and avoids existing names", () => {
    const current = state();
    current.files[0] = { ...current.files[0], content: "beforeafter" };
    current.files.push(
      { path: "diagrams/math-1.tex", is_text: true, content: "", base64: null },
      { path: "diagrams/math-1.svg", is_text: true, content: "", base64: null },
    );
    const added = addMathJaxToDocument(current, "x", "<svg />", "MathJax", {
      markdownPath: "README.md", cursor: 6,
    });
    expect(added.sourcePath).toBe("diagrams/math-2.tex");
    expect(added.state.files[0].content).toBe("before\n![MathJax](diagrams/math-2.svg)\nafter");
  });

  test("updates and finds MathJax resources", () => {
    const added = addMathJaxToDocument(state(), "x", "<svg>first</svg>", "MathJax");
    const updated = saveMathJaxToDocument(added.state, added.sourcePath, "y", "<svg>second</svg>");
    expect(updated.files.find((file) => file.path === added.sourcePath)?.content).toBe("y");
    expect(updated.files.find((file) => file.path === added.svgPath)?.content).toBe("<svg>second</svg>");
    expect(findMathJaxResourceBySource(updated.manifest, added.sourcePath)?.rendered).toBe(added.svgPath);
    expect(findMathJaxResourceByRendered(updated.manifest, added.svgPath)?.source).toBe(added.sourcePath);
  });
});
