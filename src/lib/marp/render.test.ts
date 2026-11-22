import { expect, test } from "vitest";
import { renderMarp } from "./render";

test("passes complete BOM/CRLF source to Marp and maps real slides, not fenced separators", () => {
  const source = "\uFEFF---\r\nmarp: true\r\n---\r\n# 😀 A\r\n\r\n```\r\n---\r\n```\r\n\r\n---\r\n# B";
  const result = renderMarp(source, "", []);
  expect(result.slides).toEqual([
    { slideIndex: 0, startOffset: 0, endOffset: source.lastIndexOf("---") },
    { slideIndex: 1, startOffset: source.lastIndexOf("---"), endOffset: source.length },
  ]);
  expect(result.html).toContain("😀 A");
  expect(result.html).toContain("<pre");
});

test.each(["default", "gaia", "uncover"])("uses standard theme %s, 4:3, directives and offline MathJax SVG", (theme) => {
  const result = renderMarp(`---\nmarp: true\ntheme: ${theme}\nsize: 4:3\npaginate: true\nheader: Header\nfooter: Footer\n---\n# A\n$x^2$`, "", []);
  expect(result.html).toContain('viewBox="0 0 960 720"');
  expect(result.html).toContain("Header");
  expect(result.html).toContain("Footer");
  expect(result.html).toContain("mjx-container");
  expect(result.css).toContain("section");
});

test("ignores document styles, raw HTML and unknown themes", () => {
  const result = renderMarp('---\nmarp: true\ntheme: unknown\nstyle: "section { --injected: 1 }"\n---\n<style>section { --evil: 1 }</style>\n\n<script>alert(1)</script>', "", []);
  expect(result.css).not.toContain("--injected");
  expect(result.css).not.toContain("--evil");
  expect(result.html).not.toContain("<script");
  expect(result.warnings.join(" ")).toMatch(/theme|テーマ/);
  expect(result.warnings.join(" ")).toMatch(/style|スタイル/);
});
