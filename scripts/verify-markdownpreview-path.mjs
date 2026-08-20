import { chromium } from "playwright-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

// renderSvg の出力に近い SVG（xmlns 付き）
const svgContent = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
<defs>
<marker id="arrowhead" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
<polygon points="0 0, 10 3, 0 6" fill="#000000" />
</marker>
</defs>
<rect x="100" y="100" width="200" height="80" fill="#fff" stroke="#000" stroke-width="1"></rect>
<text x="200" y="140" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif">API</text>
</svg>
`;

// MarkdownPreview の埋め込み経路を再現
const markdownHtml = `<div class="drawing-image" data-drawpath="foo">${svgContent}</div>`;

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
await page.setContent("<div id='host'></div>");

const result = await page.evaluate((markdownHtml) => {
  // sanitizeHtml と同等
  function sanitizeHtml(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const dangerousTags = ["script", "iframe", "object", "embed"];
    for (const tag of dangerousTags) {
      doc.body.querySelectorAll(tag).forEach((el) => el.remove());
    }
    const dangerousAttrs = [/^on/i, /^javascript:/i];
    for (const el of Array.from(doc.body.querySelectorAll("*"))) {
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name;
        const value = attr.value;
        if (dangerousAttrs.some((re) => re.test(name) || re.test(value))) {
          el.removeAttribute(name);
        }
      }
    }
    return doc.body.innerHTML;
  }

  const sanitized = sanitizeHtml(markdownHtml);

  // 実際の埋め込み: dangerouslySetInnerHTML 相当
  const host = document.getElementById("host");
  host.innerHTML = sanitized;

  const svgEl = host.querySelector("svg");
  const rectEl = host.querySelector("rect");
  const textEl = host.querySelector("text");

  let rectBox = null;
  let textBox = null;
  if (rectEl) {
    const b = rectEl.getBoundingClientRect();
    rectBox = { x: b.x, y: b.y, w: b.width, h: b.height };
  }
  if (textEl) {
    const b = textEl.getBoundingClientRect();
    textBox = { x: b.x, y: b.y, w: b.width, h: b.height };
  }

  return {
    sanitized,
    svgNs: svgEl ? svgEl.namespaceURI : null,
    rectNs: rectEl ? rectEl.namespaceURI : null,
    textNs: textEl ? textEl.namespaceURI : null,
    rectBox,
    textBox,
    svgRendered: svgEl ? svgEl.getBoundingClientRect().width : 0,
  };
}, markdownHtml);

console.log("=== sanitizeHtml output (div-wrapped) ===");
console.log(result.sanitized);
console.log("=== namespace ===");
console.log("svg ns:", result.svgNs);
console.log("rect ns:", result.rectNs);
console.log("text ns:", result.textNs);
console.log("=== layout (rendered?) ===");
console.log("svg width:", result.svgRendered);
console.log("rect box:", JSON.stringify(result.rectBox));
console.log("text box:", JSON.stringify(result.textBox));

await browser.close();
