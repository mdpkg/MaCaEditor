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

  test("renders rectangle with fill, stroke and stroke-width", () => {
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
        },
      ]),
    );
    expect(svg).toContain('fill="#fff"');
    expect(svg).toContain('stroke="#000"');
    expect(svg).toContain('stroke-width="1"');
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

  test("renders ellipse with rx, ry and style", () => {
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
          style: { fill: "#fff", stroke: "#000", strokeWidth: 2 },
        },
      ]),
    );
    expect(svg).toContain('rx="100"');
    expect(svg).toContain('ry="40"');
    expect(svg).toContain('fill="#fff"');
    expect(svg).toContain('stroke="#000"');
    expect(svg).toContain('stroke-width="2"');
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

  test("connector follows image positions and sizes", () => {
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
          from: { objectId: "img1" },
          to: { objectId: "img2" },
          style: { stroke: "#000", strokeWidth: 1 },
        },
        {
          id: "img1",
          type: "image",
          x: 0,
          y: 0,
          width: 100,
          height: 50,
          rotation: 0,
          zIndex: 0,
          src: "data:image/png;base64,AAAA",
          style: {},
        },
        {
          id: "img2",
          type: "image",
          x: 300,
          y: 0,
          width: 100,
          height: 50,
          rotation: 0,
          zIndex: 0,
          src: "data:image/png;base64,BBBB",
          style: {},
        },
      ]),
    );
    // fromAnchor: img1 の右端中央 (100, 25)
    expect(svg).toContain('x1="100"');
    expect(svg).toContain('y1="25"');
    // toAnchor: img2 の左端中央 (300, 25)
    expect(svg).toContain('x2="300"');
    expect(svg).toContain('y2="25"');
  });

  test("connector follows image move and resize", () => {
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
          from: { objectId: "img1" },
          to: { objectId: "img2" },
          style: { stroke: "#000", strokeWidth: 1 },
        },
        {
          id: "img1",
          type: "image",
          x: 50,
          y: 40,
          width: 200,
          height: 100,
          rotation: 0,
          zIndex: 0,
          src: "data:image/png;base64,AAAA",
          style: {},
        },
        {
          id: "img2",
          type: "image",
          x: 400,
          y: 40,
          width: 80,
          height: 60,
          rotation: 0,
          zIndex: 0,
          src: "data:image/png;base64,BBBB",
          style: {},
        },
      ]),
    );
    // fromAnchor: img1 の右端中央 (250, 90)
    expect(svg).toContain('x1="250"');
    expect(svg).toContain('y1="90"');
    // toAnchor: img2 の左端中央 (400, 70)
    expect(svg).toContain('x2="400"');
    expect(svg).toContain('y2="70"');
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
