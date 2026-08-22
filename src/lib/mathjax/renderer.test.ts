import { describe, expect, test } from "vitest";
import { sanitizeHtml } from "../sanitize";
import { renderMathJax } from "./renderer";

describe("MathJax renderer", () => {
  test("renders TeX as a self-contained SVG that survives sanitization", async () => {
    const svg = await renderMathJax(String.raw`\frac{a}{b}`);
    expect(svg).toMatch(/^<svg[\s>]/);
    expect(svg).toContain("xmlns=\"http://www.w3.org/2000/svg\"");
    expect(sanitizeHtml(svg)).toContain("<svg");
  }, 30_000);
});
