import { describe, expect, test } from "vitest";
import { sanitizeHtml } from "./sanitize";
import { renderSvg, type DrawingDocument } from "@maca/drawing-core";

function doc(objects: DrawingDocument["objects"]): DrawingDocument {
  return {
    format: "maca-drawing",
    version: "1.0",
    canvas: { width: 1200, height: 800, gridSize: 10 },
    objects,
  };
}

function sampleSvg(): string {
  return renderSvg(
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
}

describe("sanitizeHtml with SVG", () => {
  test("keeps svg root and rect after sanitize", () => {
    const svg = sampleSvg();
    const result = sanitizeHtml(svg);
    expect(result).toContain("<svg");
    expect(result).toContain("<rect");
    expect(result).toContain("</svg>");
  });

  test("preserves svg namespace so it renders as SVG", () => {
    const result = sanitizeHtml(sampleSvg());
    // text/html パースでは svg は HTML 名前空間に入るため、xmlns が失われる
    expect(result).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  test("keeps svg as a direct child (not wrapped in p or other tags)", () => {
    const result = sanitizeHtml(sampleSvg());
    // body 直下に svg が残り、p タグなどに包まれていないこと
    expect(result.startsWith("<svg") || result.includes("><svg")).toBe(true);
  });

  test("removes script inside svg", () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="10" height="10"/></svg>';
    const result = sanitizeHtml(svg);
    expect(result).not.toContain("script");
    expect(result).toContain("<rect");
  });

  test("removes event handler attributes inside svg", () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><rect onload="alert(1)" width="10" height="10"/></svg>';
    const result = sanitizeHtml(svg);
    expect(result).not.toContain("onload");
  });

  test("keeps image href attribute intact", () => {
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
    const result = sanitizeHtml(svg);
    expect(result).toContain('href="data:image/png;base64,AAAA"');
  });
});
