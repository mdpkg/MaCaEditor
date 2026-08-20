import { describe, expect, test } from "vitest";
import type { DrawingDocument } from "./model";
import {
  DEFAULT_DRAWING_DIR,
  generateDrawingFiles,
  markdownImageRef,
  nextDrawingName,
} from "./integration";

function doc(): DrawingDocument {
  return {
    format: "maca-drawing",
    version: "1.0",
    canvas: { width: 1200, height: 800, gridSize: 10 },
    objects: [],
  };
}

describe("integration", () => {
  test("default drawing directory is diagrams", () => {
    expect(DEFAULT_DRAWING_DIR).toBe("diagrams");
  });

  test("generates draw and svg paths", () => {
    const files = generateDrawingFiles(doc(), "diagrams", "architecture");
    expect(files.drawPath).toBe("diagrams/architecture.draw.json");
    expect(files.svgPath).toBe("diagrams/architecture.svg");
  });

  test("draw content is serialized json", () => {
    const files = generateDrawingFiles(doc(), "diagrams", "architecture");
    const parsed = JSON.parse(files.drawContent);
    expect(parsed.format).toBe("maca-drawing");
  });

  test("svg content is svg", () => {
    const files = generateDrawingFiles(doc(), "diagrams", "architecture");
    expect(files.svgContent).toContain("<svg");
  });

  test("generates a rendered SVG fitted to drawing content", () => {
    const drawing = doc();
    drawing.objects = [{
      id: "r1", type: "rectangle", x: 100, y: 80, width: 200, height: 60,
      rotation: 0, zIndex: 1, style: {},
    }];
    const files = generateDrawingFiles(drawing, "diagrams", "fitted");
    expect(files.svgContent).toContain('viewBox="80 60 240 100"');
  });

  test("uses an explicitly resized canvas for the rendered SVG", () => {
    const drawing = doc();
    drawing.canvas = { ...drawing.canvas, width: 640, height: 360, fitToContent: false };
    drawing.objects = [{
      id: "r1", type: "rectangle", x: 100, y: 80, width: 200, height: 60,
      rotation: 0, zIndex: 1, style: {},
    }];

    const files = generateDrawingFiles(drawing, "diagrams", "manual-size");

    expect(files.svgContent).toContain('width="640" height="360" viewBox="0 0 640 360"');
  });

  test("next name avoids existing files", () => {
    const name = nextDrawingName("diagrams", [
      "diagrams/drawing-1.draw.json",
      "diagrams/drawing-1.svg",
    ]);
    expect(name).toBe("drawing-2");
  });

  test("next name starts at drawing-1", () => {
    const name = nextDrawingName("diagrams", []);
    expect(name).toBe("drawing-1");
  });

  test("markdown image ref", () => {
    expect(markdownImageRef("diagrams/a.svg", "Architecture")).toBe(
      "![Architecture](diagrams/a.svg)",
    );
  });
});
