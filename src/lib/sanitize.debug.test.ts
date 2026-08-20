import { describe, expect, test } from "vitest";
import { sanitizeHtml } from "./sanitize";
import { renderSvg } from "./drawing/svg";
import type { DrawingDocument } from "./drawing/model";

function doc(objects: DrawingDocument["objects"]): DrawingDocument {
  return {
    format: "maca-drawing",
    version: "1.0",
    canvas: { width: 1200, height: 800, gridSize: 10 },
    objects,
  };
}

describe("debug sanitizeHtml SVG namespace", () => {
  test("prints sanitized output", () => {
    const svg = renderSvg(
      doc([
        {
          id: "r1",
          type: "rectangle",
          x: 100,
          y: 100,
          width: 200,
          height: 80,
          rotation: 0,
          zIndex: 1,
          style: { fill: "#fff", stroke: "#000", strokeWidth: 1 },
          text: "API",
        },
      ]),
    );
    const result = sanitizeHtml(svg);
    console.log("INPUT:", svg);
    console.log("OUTPUT:", result);
    expect(true).toBe(true);
  });
});
