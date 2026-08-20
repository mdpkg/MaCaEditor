import { describe, expect, test } from "vitest";
import type { DocumentState } from "../document";
import type { DrawingDocument } from "./model";
import {
  DEFAULT_DRAWING_DIR,
  addDrawingToDocument,
  findDrawingResources,
  findResourceByRendered,
  findResourceBySource,
  saveDrawingToDocument,
} from "./docIntegration";

function state(): DocumentState {
  return {
    path: "test.mdpkg",
    entrypoint: "README.md",
    files: [
      { path: "README.md", is_text: true, content: "# Hello", base64: null },
      { path: "manifest.json", is_text: true, content: "{}", base64: null },
    ],
    manifest: { format: "mdpkg", version: "1.0", entrypoint: "README.md", title: "T" },
    dirty: false,
  };
}

function drawing(): DrawingDocument {
  return {
    format: "maca-drawing",
    version: "1.0",
    canvas: { width: 1200, height: 800, gridSize: 10 },
    objects: [],
  };
}

describe("docIntegration", () => {
  test("default drawing directory is diagrams", () => {
    expect(DEFAULT_DRAWING_DIR).toBe("diagrams");
  });

  test("adds drawing files to document", () => {
    const { state: next } = addDrawingToDocument(state(), drawing(), "diagrams", "Drawing");
    expect(next.files.some((f) => f.path === "diagrams/drawing-1.draw.json")).toBe(true);
    expect(next.files.some((f) => f.path === "diagrams/drawing-1.svg")).toBe(true);
  });

  test("adds manifest resource", () => {
    const { state: next } = addDrawingToDocument(state(), drawing(), "diagrams", "Drawing");
    const resources = next.manifest.resources as Array<{ source: string; rendered: string; type: string }>;
    expect(resources.length).toBe(1);
    expect(resources[0].type).toBe("drawing");
    expect(resources[0].source).toBe("diagrams/drawing-1.draw.json");
    expect(resources[0].rendered).toBe("diagrams/drawing-1.svg");
  });

  test("inserts markdown image ref", () => {
    const { state: next } = addDrawingToDocument(state(), drawing(), "diagrams", "Drawing");
    const readme = next.files.find((f) => f.path === "README.md");
    expect(readme?.content).toContain("![Drawing](diagrams/drawing-1.svg)");
  });

  test("marks document dirty", () => {
    const { state: next } = addDrawingToDocument(state(), drawing(), "diagrams", "Drawing");
    expect(next.dirty).toBe(true);
  });

  test("avoids existing file names", () => {
    const s = state();
    const { state: first } = addDrawingToDocument(s, drawing(), "diagrams", "Drawing");
    const { state: second } = addDrawingToDocument(first, drawing(), "diagrams", "Drawing");
    expect(second.files.some((f) => f.path === "diagrams/drawing-2.draw.json")).toBe(true);
  });

  test("saveDrawingToDocument regenerates svg", () => {
    const { state: next } = addDrawingToDocument(state(), drawing(), "diagrams", "Drawing");
    const drawPath = "diagrams/drawing-1.draw.json";
    const updated = saveDrawingToDocument(next, drawPath, drawing());
    const svg = updated.files.find((f) => f.path === "diagrams/drawing-1.svg");
    expect(svg?.content).toContain("<svg");
    expect(updated.dirty).toBe(true);
  });

  test("findDrawingResources filters type drawing", () => {
    const manifest = {
      resources: [
        { source: "a.puml", rendered: "a.svg", type: "plantuml" },
        { source: "b.draw.json", rendered: "b.svg", type: "drawing" },
      ],
    };
    const resources = findDrawingResources(manifest);
    expect(resources.length).toBe(1);
    expect(resources[0].source).toBe("b.draw.json");
  });

  test("findResourceByRendered", () => {
    const manifest = {
      resources: [{ source: "b.draw.json", rendered: "b.svg", type: "drawing" }],
    };
    const r = findResourceByRendered(manifest, "b.svg");
    expect(r?.source).toBe("b.draw.json");
  });

  test("findResourceBySource", () => {
    const manifest = {
      resources: [{ source: "b.draw.json", rendered: "b.svg", type: "drawing" }],
    };
    const r = findResourceBySource(manifest, "b.draw.json");
    expect(r?.rendered).toBe("b.svg");
  });
});
