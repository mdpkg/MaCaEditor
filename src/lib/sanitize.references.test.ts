import { expect, test } from "vitest";
import { sanitizeHtml } from "./sanitize";

function svg(body: string): Element {
  const host = document.createElement("div");
  host.innerHTML = sanitizeHtml(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${body}</svg>`);
  return host.querySelector("svg")!;
}

test.each(["image", "use", "a", "rect"])("rejects nonlocal URL attributes on SVG %s", (tag) => {
  for (const attr of ["href", "xlink:href", "src"]) {
    for (const url of ["http://127.0.0.1:1/x", "https://127.0.0.1/x", "//127.0.0.1/x", "file:///x",
      "other.svg#x", "%23id", "#id&#9;x", "javascript:probe()", "java%09script:probe()",
      "data:text/html,x", "data:image/svg+xml;base64,PHN2Zy8+", "data:image/png;base64,AAAA"]) {
      // Embedded raster data is allowed only on image href attributes.
      if (tag === "image" && attr !== "src" && url === "data:image/png;base64,AAAA") continue;
      expect(svg(`<${tag} ${attr}="${url}"/>`).firstElementChild?.getAttribute(attr), `${tag} ${attr}=${url}`).toBeNull();
    }
  }
});

test.each(["fill", "stroke", "filter", "mask", "clip-path", "marker-start", "cursor"])("blocks external CSS in SVG %s", (attr) => {
  for (const value of ["url(http://127.0.0.1:1/x)", "url(//127.0.0.1/x)", "url(data:image/png;base64,AAAA)",
    "u\\72l(http://127.0.0.1/x)", "url(/**/#id)", "var(--external)", 'image-set("http://127.0.0.1/x" 1x)']) {
    expect(svg(`<rect ${attr}="${value.replace(/"/g, "&quot;")}"/>`).firstElementChild?.getAttribute(attr)).toBeNull();
  }
});

test("blocks CSS string-fetch functions, escaped URLs, font imports and mutable SVG URLs", () => {
  const result = svg('<style>@import "http://127.0.0.1:1/import"; @font-face {font-family:x;src:url(http://127.0.0.1:1/font)}</style>'
    + '<rect style="background-image:image-set(&quot;http://127.0.0.1:1/image&quot; 1x)"/>'
    + '<image href="#id"><set attributeName="href" to="http://127.0.0.1:1/set"/><animate attributeName="href" values="#id;http://127.0.0.1:1/animate"/></image>');
  expect(result.querySelector("style, set, animate")).toBeNull();
  expect(result.querySelector("rect")?.getAttribute("style")).toBeNull();
});

test("keeps local SVG paint, clip, mask, filter, marker, use and anchor references", () => {
  const result = svg('<defs><linearGradient id="g"/><clipPath id="c"/><mask id="m"/><filter id="f"/><marker id="a"/><pattern id="p"/></defs>'
    + '<rect fill="url(#g)" stroke="url(#p)" clip-path="url(#c)" mask="url(#m)" filter="url(#f)" marker-start="url(#a)"/>'
    + '<use href="#shape"/><a href="#shape"><text>local</text></a>');
  expect(result.querySelector("rect")?.getAttribute("fill")).toBe("url(#g)");
  for (const attr of ["stroke", "clip-path", "mask", "filter", "marker-start"]) expect(result.querySelector("rect")?.hasAttribute(attr)).toBe(true);
  expect(result.querySelector("use")?.getAttribute("href")).toBe("#shape");
  expect(result.querySelector("a")?.getAttribute("href")).toBe("#shape");
});
