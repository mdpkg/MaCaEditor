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

  test("returns TeX errors as original text and renders valid input afterward", async () => {
    await expect(renderMathJax("x^{")).rejects.toThrow("Extra open brace or missing close brace");
    await expect(renderMathJax(String.raw`\notARealMacro`)).rejects.toThrow("Undefined control sequence");
    await expect(renderMathJax("x^2")).resolves.toMatch(/^<svg[\s>]/);
  });
});
