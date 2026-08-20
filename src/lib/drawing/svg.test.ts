import { describe, expect, test } from "vitest";
import type { DrawingDocument } from "./model";
import { renderSvg } from "./svg";

function doc(objects: DrawingDocument["objects"]): DrawingDocument {
  return {
    format: "maca-drawing",
    version: "1.0",
    canvas: { width: 1200, height: 800, gridSize: 10 },
    objects,
  };
}

describe("svg renderer", () => {
  test("renders canvas svg root", () => {
    const svg = renderSvg(doc([]));
    expect(svg).toContain("<svg");
    expect(svg).toContain('width="1200"');
    expect(svg).toContain('height="800"');
  });

  test("renders rectangle", () => {
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
    expect(svg).toContain("<rect");
    expect(svg).toContain('width="200"');
    expect(svg).toContain('height="80"');
    expect(svg).toContain("API");
  });

  test("renders ellipse", () => {
    const svg = renderSvg(
      doc([
        {
          id: "e1",
          type: "ellipse",
          x: 100,
          y: 100,
          width: 200,
          height: 80,
          rotation: 0,
          zIndex: 1,
          style: { fill: "#fff", stroke: "#000", strokeWidth: 1 },
        },
      ]),
    );
    expect(svg).toContain("<ellipse");
    expect(svg).toContain('cx="200"');
    expect(svg).toContain('cy="140"');
  });

  test("renders text", () => {
    const svg = renderSvg(
      doc([
        {
          id: "t1",
          type: "text",
          x: 100,
          y: 100,
          width: 100,
          height: 20,
          rotation: 0,
          zIndex: 1,
          text: "Hello",
          style: { fontSize: 16, color: "#333" },
        },
      ]),
    );
    expect(svg).toContain("<text");
    expect(svg).toContain("Hello");
  });

  test("renders line", () => {
    const svg = renderSvg(
      doc([
        {
          id: "l1",
          type: "line",
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          rotation: 0,
          zIndex: 1,
          x2: 100,
          y2: 100,
          style: { stroke: "#000", strokeWidth: 1 },
        },
      ]),
    );
    expect(svg).toContain("<line");
    expect(svg).toContain('x1="0"');
    expect(svg).toContain('x2="100"');
  });

  test("renders arrow with marker", () => {
    const svg = renderSvg(
      doc([
        {
          id: "a1",
          type: "arrow",
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          rotation: 0,
          zIndex: 1,
          x2: 100,
          y2: 100,
          style: { stroke: "#000", strokeWidth: 1 },
        },
      ]),
    );
    expect(svg).toContain("marker");
    expect(svg).toContain("arrowhead");
  });

  test("renders image with src and dimensions", () => {
    const svg = renderSvg(
      doc([
        {
          id: "img1",
          type: "image",
          x: 100,
          y: 100,
          width: 200,
          height: 80,
          rotation: 0,
          zIndex: 1,
          src: "data:image/png;base64,AAAA",
          style: {},
        },
      ]),
    );
    expect(svg).toContain("<image");
    expect(svg).toContain('width="200"');
    expect(svg).toContain('height="80"');
    expect(svg).toContain("AAAA");
    expect(svg).toContain('href="data:image/png;base64,AAAA"');
    expect(svg).toContain('preserveAspectRatio="xMidYMid meet"');
  });

  test("skips image with empty src", () => {
    const svg = renderSvg(
      doc([
        {
          id: "img1",
          type: "image",
          x: 100,
          y: 100,
          width: 200,
          height: 80,
          rotation: 0,
          zIndex: 1,
          src: "",
          style: {},
        },
      ]),
    );
    expect(svg).not.toContain("<image");
  });

  test("renders connector as line", () => {
    const svg = renderSvg(
      doc([
        {
          id: "c1",
          type: "connector",
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          rotation: 0,
          zIndex: 1,
          from: { objectId: "r1" },
          to: { objectId: "r2" },
          style: { stroke: "#000", strokeWidth: 1 },
        },
        {
          id: "r1",
          type: "rectangle",
          x: 0,
          y: 0,
          width: 100,
          height: 50,
          rotation: 0,
          zIndex: 0,
          style: {},
        },
        {
          id: "r2",
          type: "rectangle",
          x: 300,
          y: 0,
          width: 100,
          height: 50,
          rotation: 0,
          zIndex: 0,
          style: {},
        },
      ]),
    );
    expect(svg).toContain("<line");
  });

  test("output is deterministic", () => {
    const d = doc([
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
    ]);
    expect(renderSvg(d)).toBe(renderSvg(d));
  });

  test("contains no script or event handlers", () => {
    const svg = renderSvg(
      doc([
        {
          id: "r1",
          type: "rectangle",
          x: 0,
          y: 0,
          width: 100,
          height: 50,
          rotation: 0,
          zIndex: 1,
          style: {},
          text: "<script>",
        },
      ]),
    );
    expect(svg).not.toContain("<script");
    expect(svg).not.toContain("onload");
  });
});
