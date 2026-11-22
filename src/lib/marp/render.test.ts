import { expect, test } from "vitest";
import { renderMarp } from "./render";
import type { FileInfo } from "../../types";

const png: FileInfo = { path: "images/図 1.png", is_text: false, content: null, base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=" };
const svg: FileInfo = { path: "images/diagram.svg", is_text: true, base64: null, content: '<svg xmlns="http://www.w3.org/2000/svg"><script>evil()</script><image href="https://invalid.test/secret"/><rect width="10" height="10" onload="evil()"/></svg>' };

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

test("resolves relative, reference, header, SVG and background images without changing source", () => {
  const source = '---\nmarp: true\nheader: "![logo](../images/diagram.svg)"\n---\n![normal][pic]\n\n![bg](../images/diagram.svg)\n\n[pic]: <../images/%E5%9B%B3%201.png>';
  const result = renderMarp(source, "slides", [png, svg]);
  expect(result.html).toContain("data:image/png;base64,");
  expect(result.html).toContain("data:image/svg+xml;base64,");
  expect(result.html).not.toContain("https://invalid.test");
  expect(result.warnings).toEqual([]);
  const changed = renderMarp(source, "slides", [png, { ...svg, content: svg.content!.replace('width="10"', 'width="20"') }]);
  expect(changed.html).not.toBe(result.html);
});

test.each(["https://invalid.test/a.png", "//invalid.test/a", "../../secret.png", "javascript:evil()", "data:image/svg+xml,evil", "file:///secret.png", "missing.png", "%2f%2finvalid.test/a"])("warns and blocks disallowed/missing image %s", (url) => {
  const result = renderMarp(`---\nmarp: true\nbackgroundImage: url('${url}')\n---\n![image](${url})`, "", [png]);
  expect(result.html).not.toContain('src="http');
  expect(result.html).not.toContain("invalid.test");
  expect(result.warnings.length).toBeGreaterThan(0);
});

test("does not treat arbitrary bytes or oversized resources as images", () => {
  const result = renderMarp("# A\n![a](images/図%201.png)", "", [{ ...png, base64: btoa("not a PNG") }]);
  expect(result.warnings.length).toBeGreaterThan(0);
  expect(result.html).not.toContain("data:image/png");
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
