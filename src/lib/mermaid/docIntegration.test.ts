import { describe, expect, test } from "vitest";
import type { DocumentState } from "../document";
import {
  DEFAULT_MERMAID_SOURCE,
  addMermaidToDocument,
  findMermaidResourceByRendered,
  findMermaidResourceBySource,
  saveMermaidToDocument,
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

describe("Mermaid document integration", () => {
  test("adds source, SVG, resource, and Markdown reference", () => {
    const added = addMermaidToDocument(state(), DEFAULT_MERMAID_SOURCE, "<svg>first</svg>", "Mermaid");

    expect(added.sourcePath).toBe("diagrams/mermaid-1.mmd");
    expect(added.svgPath).toBe("diagrams/mermaid-1.svg");
    expect(added.state.files.find((file) => file.path === added.sourcePath)?.content)
      .toBe(DEFAULT_MERMAID_SOURCE);
    expect(added.state.manifest.resources).toContainEqual({
      source: added.sourcePath, rendered: added.svgPath, type: "mermaid",
    });
    expect(added.state.files[0].content).toContain("![Mermaid](diagrams/mermaid-1.svg)");
  });

  test("uses the cursor and avoids existing names", () => {
    const current = state();
    current.files[0] = { ...current.files[0], content: "beforeafter" };
    current.files.push(
      { path: "diagrams/mermaid-1.mmd", is_text: true, content: "", base64: null },
      { path: "diagrams/mermaid-1.svg", is_text: true, content: "", base64: null },
    );
    const added = addMermaidToDocument(
      current, DEFAULT_MERMAID_SOURCE, "<svg />", "Mermaid",
      { markdownPath: "README.md", cursor: 6 },
    );
    expect(added.sourcePath).toBe("diagrams/mermaid-2.mmd");
    expect(added.state.files[0].content)
      .toBe("before\n![Mermaid](diagrams/mermaid-2.svg)\nafter");
  });

  test("updates source and SVG together", () => {
    const added = addMermaidToDocument(state(), DEFAULT_MERMAID_SOURCE, "<svg>first</svg>", "Mermaid");
    const updated = saveMermaidToDocument(
      added.state, added.sourcePath, "flowchart LR\nB --> C", "<svg>second</svg>",
    );
    expect(updated.files.find((file) => file.path === added.sourcePath)?.content).toContain("B --> C");
    expect(updated.files.find((file) => file.path === added.svgPath)?.content).toBe("<svg>second</svg>");
  });

  test("finds Mermaid resources by source and rendered path", () => {
    const manifest = { resources: [
      { source: "a.puml", rendered: "a.svg", type: "plantuml" },
      { source: "b.mmd", rendered: "b.svg", type: "mermaid" },
    ] };
    expect(findMermaidResourceBySource(manifest, "b.mmd")?.rendered).toBe("b.svg");
    expect(findMermaidResourceByRendered(manifest, "b.svg")?.source).toBe("b.mmd");
    expect(findMermaidResourceBySource(manifest, "a.puml")).toBeUndefined();
  });
});
