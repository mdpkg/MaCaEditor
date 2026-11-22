import { describe, expect, test } from "vitest";
import { sanitizeHtml, sanitizeImageSrc } from "./sanitize";

describe("sanitizeHtml", () => {
  test.each([
    "javascript:alert(1)", " javascript:alert(1)", "java&#9;script:alert(1)",
    "java&#10;script:alert(1)", "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
  ])("removes unsafe HTML and SVG links: %s", (url) => {
    for (const markup of [
      `<a href='${url}'>link</a>`,
      `<svg xmlns="http://www.w3.org/2000/svg"><a href='${url}'><text>link</text></a></svg>`,
    ]) {
      const host = document.createElement("div");
      host.innerHTML = sanitizeHtml(markup);
      expect(host.querySelector("a")?.getAttribute("href") ?? null).toBeNull();
    }
  });

  test("removes foreignObject in SVG and mixed HTML, including namespaced elements", () => {
    for (const markup of [
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">payload</div></foreignObject></svg>',
      '<p>safe</p><svg><foreignObject><p>payload</p></foreignObject></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:x="http://www.w3.org/2000/svg"><x:foreignObject>payload</x:foreignObject></svg>',
    ]) expect(sanitizeHtml(markup)).not.toContain("payload");
  });

  test("rejects malformed SVG and styles that load external content", () => {
    expect(sanitizeHtml('<svg xmlns="http://www.w3.org/2000/svg"><g></svg>')).toBe("");
    const result = sanitizeHtml('<svg><style>@import "https://example.com/style";</style><rect style="fill: url(https://example.com/image)" /></svg>');
    expect(result).not.toContain("example.com");
    expect(sanitizeHtml('<svg><rect style="fill: red; stroke: blue" /></svg>')).toContain("fill: red");
  });

  test("preserves local SVG references and allows external links only in HTML", () => {
    const result = sanitizeHtml('<svg xmlns="http://www.w3.org/2000/svg"><defs><path id="shape" d="M0 0" /></defs><use href="#shape"/><a href="https://example.com"><text>link</text></a></svg>');
    expect(result).toContain('href="#shape"');
    expect(result).not.toContain('href="https://example.com"');
    expect(sanitizeHtml('<a href="https://example.com">link</a>')).toContain('href="https://example.com"');
  });

  test("preserves diagram stylesheet colors without publishing global CSS", () => {
    const result = sanitizeHtml('<svg xmlns="http://www.w3.org/2000/svg" id="diagram"><style>.node {fill: red; stroke: blue} body {display:none}</style><rect class="node" width="10" height="10"/></svg>');
    expect(result).not.toContain("<style");
    expect(result).not.toContain("body");
    expect(result).toContain("fill:red");
    expect(result).toContain("stroke:blue");
  });

  test("removes script tags", () => {
    const result = sanitizeHtml("<script>alert(1)</script><p>ok</p>");
    expect(result).not.toContain("script");
    expect(result).toContain("ok");
  });

  test("removes iframe tags", () => {
    const result = sanitizeHtml("<iframe src='x'></iframe>");
    expect(result).not.toContain("iframe");
  });

  test("removes event handler attributes", () => {
    const result = sanitizeHtml("<p onclick='alert(1)'>ok</p>");
    expect(result).not.toContain("onclick");
  });

  test("removes javascript urls", () => {
    const result = sanitizeHtml("<a href='javascript:alert(1)'>link</a>");
    expect(result).not.toContain("javascript:");
  });

  test("keeps safe content", () => {
    const result = sanitizeHtml("<p>hello <strong>world</strong></p>");
    expect(result).toContain("hello");
    expect(result).toContain("world");
  });
});

describe("sanitizeImageSrc", () => {
  test("keeps data:image src", () => {
    const src = "data:image/png;base64,AAAA";
    expect(sanitizeImageSrc(src)).toBe(src);
  });

  test("keeps http src", () => {
    const src = "http://example.com/image.png";
    expect(sanitizeImageSrc(src)).toBe(src);
  });

  test("keeps https src", () => {
    const src = "https://example.com/image.png";
    expect(sanitizeImageSrc(src)).toBe(src);
  });

  test("rejects javascript: src", () => {
    expect(sanitizeImageSrc("javascript:alert(1)")).toBe("");
  });

  test("rejects non-image data src", () => {
    expect(sanitizeImageSrc("data:text/html;base64,PHNjcmlwdD4=")).toBe("");
  });

  test("rejects unsafe schemes like file: and vbscript:", () => {
    expect(sanitizeImageSrc("file:///etc/passwd")).toBe("");
    expect(sanitizeImageSrc("vbscript:msgbox(1)")).toBe("");
  });

  test("rejects empty src", () => {
    expect(sanitizeImageSrc("")).toBe("");
  });

  test("rejects whitespace-only src", () => {
    expect(sanitizeImageSrc("   ")).toBe("");
  });

  test("keeps http src with query and fragment", () => {
    const src = "http://example.com/image.png?size=large#thumb";
    expect(sanitizeImageSrc(src)).toBe(src);
  });

  test("keeps https src with port", () => {
    const src = "https://example.com:8443/image.png";
    expect(sanitizeImageSrc(src)).toBe(src);
  });

  test("keeps data:image with uppercase scheme", () => {
    const src = "DATA:image/png;base64,AAAA";
    expect(sanitizeImageSrc(src)).toBe(src);
  });

  test("keeps data:image/svg+xml", () => {
    const src = "data:image/svg+xml;base64,PHN2Zz4=";
    expect(sanitizeImageSrc(src)).toBe(src);
  });

  test("rejects malformed http src without host", () => {
    expect(sanitizeImageSrc("http://")).toBe("");
    expect(sanitizeImageSrc("https://")).toBe("");
  });

  test("rejects http src with whitespace in host", () => {
    expect(sanitizeImageSrc("http://exa mple.com/image.png")).toBe("");
  });

  test("rejects protocol-relative src", () => {
    expect(sanitizeImageSrc("//example.com/image.png")).toBe("");
  });

  test("rejects http src without slashes", () => {
    expect(sanitizeImageSrc("http:example.com/image.png")).toBe("");
  });

  test("rejects unsupported schemes like ftp:", () => {
    expect(sanitizeImageSrc("ftp://example.com/image.png")).toBe("");
  });
});
