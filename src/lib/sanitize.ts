import createDOMPurify from "dompurify";

const purifier = createDOMPurify(window);
const safeCssFunction = /^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|calc|min|max|clamp|matrix|matrix3d|translate(?:x|y|z|3d)?|scale(?:x|y|z|3d)?|rotate(?:x|y|z|3d)?|skew(?:x|y)?)$/i;

function safeSvgReference(node: Element, name: string, value: string): boolean {
  if (/^#[\w:.-]+$/.test(value)) return true;
  // Raster data on image href is inert and retains drawing-core's embedded
  // images. Data SVG/HTML and navigable data links are never admitted.
  return node.localName === "image" && name !== "src"
    && /^data:image\/(?:png|jpeg|gif|webp|bmp);base64,[a-z\d+/]+={0,2}$/i.test(value);
}

function unsafeCss(value: string): boolean {
  const withoutLocalReferences = value.replace(/url\(\s*["']?#[\w:.-]+["']?\s*\)/gi, "");
  if (/(?:url\s*\(|@|\\|\/\*)/i.test(withoutLocalReferences)) return true;
  // Fail closed for CSS functions that can fetch strings (image-set, src),
  // inherit URLs from the host (var), or gain new resource-loading semantics.
  const functions = withoutLocalReferences.matchAll(/([\w-]+)\s*\(/g);
  return [...functions].some((match) => !safeCssFunction.test(match[1]));
}

// Exported diagrams use stylesheets for their colors and text. Copy only SVG
// presentation properties onto matching elements before discarding stylesheets,
// so a package stylesheet cannot affect the application UI.
function inlineSvgStyles(root: Element): void {
  const presentation = /^(?:fill(?:-opacity|-rule)?|stroke(?:-width|-opacity|-dasharray|-dashoffset|-linecap|-linejoin|-miterlimit)?|opacity|color|font-(?:family|size|weight|style)|text-anchor|dominant-baseline|marker-(?:start|mid|end)|visibility|display)$/;
  const values = new Map<Element, string[]>();
  for (const style of root.querySelectorAll("style")) {
    const css = style.textContent ?? "";
    if (unsafeCss(css)) continue;
    // Only flat rules are supported; at-rules and escapes are excluded above.
    for (const text of css.match(/[^{}]+\{[^{}]*\}/g) ?? []) {
      try {
        const sheet = new CSSStyleSheet();
        sheet.insertRule(text);
        const rule = sheet.cssRules[0] as CSSStyleRule;
        if (!rule.selectorText || !rule.style) continue;
        const declarations = [];
        for (let index = 0; index < rule.style.length; index += 1) {
          const name = rule.style[index];
          const value = rule.style.getPropertyValue(name);
          if (presentation.test(name) && !unsafeCss(value)) declarations.push(`${name}:${value}`);
        }
        const nodes = [...root.querySelectorAll(rule.selectorText)];
        if (root.matches(rule.selectorText)) nodes.push(root);
        for (const node of nodes) values.set(node, [...values.get(node) ?? [], ...declarations]);
      } catch { /* Unsupported selectors or CSS rules do not enter the preview. */ }
    }
  }
  for (const [node, declarations] of values) {
    node.setAttribute("style", `${declarations.join(";")};${node.getAttribute("style") ?? ""}`);
  }
}

// Retain diagram styles, while preventing stylesheet-based network requests.
purifier.addHook("uponSanitizeAttribute", (node, data) => {
  if (node.namespaceURI === "http://www.w3.org/2000/svg") {
    if (/^(?:href|xlink:href|src)$/.test(data.attrName) && !safeSvgReference(node, data.attrName, data.attrValue)) {
      data.keepAttr = false;
    }
    // Presentation attributes are CSS values too (filter, mask, paint, etc.).
    if (unsafeCss(data.attrValue)) data.keepAttr = false;
  }
  if (data.attrName === "style" && unsafeCss(data.attrValue)) {
    data.keepAttr = false;
  }
});
purifier.addHook("uponSanitizeElement", (node) => {
  if (node.nodeName.toLowerCase().split(":").pop() === "foreignobject") node.parentNode?.removeChild(node);
});

/** Sanitize HTML/SVG with DOMPurify's element, attribute and URL allowlists.
 * foreignObject and embedded stylesheets are intentionally excluded from previews.
 */
export function sanitizeHtml(html: string): string {
  const trimmed = html.trim();
  if (/^<svg[\s>]/i.test(trimmed)) {
    const doc = new DOMParser().parseFromString(trimmed, "image/svg+xml");
    if (doc.querySelector("parsererror")) return "";
    inlineSvgStyles(doc.documentElement);
    html = doc.documentElement.outerHTML;
  }
  return purifier.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
    ADD_TAGS: ["use"],
    FORBID_TAGS: ["foreignObject", "style", "iframe", "object", "embed", "link", "meta", "base"],
    FORBID_ATTR: ["srcdoc"],
  });
}

// The image-source policy belongs to the framework-independent drawing package.
export { sanitizeImageSrc } from "@maca/drawing-core";
