import { chromium } from "playwright-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const svgInput = `
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80">
  <rect x="10" y="10" width="180" height="60" fill="#fff" stroke="#000"/>
  <ellipse cx="100" cy="40" rx="50" ry="20" fill="#eee"/>
</svg>
`;

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
await page.setContent("<div id='host'></div>");

const result = await page.evaluate((svgInput) => {
  // sanitizeHtml と同等のロジック（text/html パース）
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

  const sanitized = sanitizeHtml(svgInput);

  // 実際の埋め込み経路: innerHTML で再挿入
  const host = document.getElementById("host");
  host.innerHTML = sanitized;

  const svgEl = host.querySelector("svg");
  const rectEl = host.querySelector("rect");
  const ellipseEl = host.querySelector("ellipse");

  let rectBox = null;
  let ellipseBox = null;
  if (rectEl) {
    const b = rectEl.getBoundingClientRect();
    rectBox = { x: b.x, y: b.y, w: b.width, h: b.height };
  }
  if (ellipseEl) {
    const b = ellipseEl.getBoundingClientRect();
    ellipseBox = { x: b.x, y: b.y, w: b.width, h: b.height };
  }

  return {
    sanitized,
    svgTag: svgEl ? svgEl.tagName : null,
    svgNs: svgEl ? svgEl.namespaceURI : null,
    rectTag: rectEl ? rectEl.tagName : null,
    rectNs: rectEl ? rectEl.namespaceURI : null,
    ellipseTag: ellipseEl ? ellipseEl.tagName : null,
    ellipseNs: ellipseEl ? ellipseEl.namespaceURI : null,
    rectBox,
    ellipseBox,
  };
}, svgInput);

console.log("=== sanitizeHtml output ===");
console.log(result.sanitized);
console.log("=== namespace ===");
console.log("svg:", result.svgTag, "ns:", result.svgNs);
console.log("rect:", result.rectTag, "ns:", result.rectNs);
console.log("ellipse:", result.ellipseTag, "ns:", result.ellipseNs);
console.log("=== layout (rendered?) ===");
console.log("rect box:", JSON.stringify(result.rectBox));
console.log("ellipse box:", JSON.stringify(result.ellipseBox));

await browser.close();
