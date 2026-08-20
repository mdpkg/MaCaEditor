import { JSDOM } from "jsdom";

const dom = new JSDOM("");
const doc = dom.window.document;

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg"><rect x="1" y="2" width="3" height="4"/></svg>';

// 1) text/html としてパース（sanitizeHtml と同じ経路）
const parsed = new dom.window.DOMParser().parseFromString(svg, "text/html");
const body = parsed.body;
console.log("=== text/html parse ===");
console.log("innerHTML:", body.innerHTML);
const svgEl = body.querySelector("svg");
console.log("tag:", svgEl?.tagName, "ns:", svgEl?.namespaceURI);
const rectEl = body.querySelector("rect");
console.log("rect tag:", rectEl?.tagName, "ns:", rectEl?.namespaceURI);

// 2) innerHTML を再挿入したときの名前空間（MarkdownPreview の埋め込み経路）
const host = doc.createElement("div");
host.innerHTML = body.innerHTML;
const reSvg = host.querySelector("svg");
console.log("=== reinserted ===");
console.log("re-svg tag:", reSvg?.tagName, "ns:", reSvg?.namespaceURI);
console.log("re-rect tag:", host.querySelector("rect")?.namespaceURI);
