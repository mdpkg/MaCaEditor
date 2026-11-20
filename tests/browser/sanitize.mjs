import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { chromium } from "playwright";

let browser;
let bundle;
before(async () => {
  const result = await build({
    configFile: false,
    logLevel: "error",
    build: {
      write: false,
      lib: { entry: fileURLToPath(new URL("../../src/lib/sanitize.ts", import.meta.url)), name: "MacaSanitize", formats: ["iife"] },
    },
  });
  const output = Array.isArray(result) ? result[0] : result;
  bundle = output.output.find((item) => item.type === "chunk").code;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); });

test("sanitized SVG cannot execute handlers or obfuscated JavaScript links in Chromium", async (t) => {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.setContent('<!doctype html><main></main>');
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(async () => {
    window.attacked = false;
    const html = '<svg xmlns="http://www.w3.org/2000/svg" onload="window.attacked=true">'
      + '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml" onclick="window.attacked=true">payload</div></foreignObject>'
      + '<a href=" java&#9;script:window.attacked=true"><text>unsafe</text></a>'
      + '<a href="data:text/html,payload"><text>data</text></a>'
      + '<rect width="10" height="10"/></svg>';
    const host = document.querySelector("main");
    host.innerHTML = window.MacaSanitize.sanitizeHtml(html);
    for (const link of host.querySelectorAll("a")) {
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {
      attacked: window.attacked,
      foreignObjects: host.querySelectorAll("foreignObject").length,
      urls: [...host.querySelectorAll("a")].map((link) => link.getAttribute("href")),
      namespace: host.querySelector("svg")?.namespaceURI,
      rectangle: Boolean(host.querySelector("rect")),
    };
  });
  assert.equal(result.attacked, false);
  assert.equal(result.foreignObjects, 0);
  assert.deepEqual(result.urls, [null, null]);
  assert.equal(result.namespace, "http://www.w3.org/2000/svg");
  assert.equal(result.rectangle, true);
});

test("diagram stylesheet colors survive without affecting the surrounding page", async (t) => {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.setContent('<!doctype html><main></main>');
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(() => {
    document.querySelector("main").innerHTML = window.MacaSanitize.sanitizeHtml(
      '<svg xmlns="http://www.w3.org/2000/svg" id="diagram"><style>#diagram .node {fill:red;stroke:blue} body {display:none}</style><rect class="node" width="20" height="10"/></svg>',
    );
    return {
      fill: getComputedStyle(document.querySelector("rect")).fill,
      stroke: getComputedStyle(document.querySelector("rect")).stroke,
      body: getComputedStyle(document.body).display,
      stylesheets: document.querySelectorAll("style").length,
    };
  });
  assert.equal(result.fill, "rgb(255, 0, 0)");
  assert.equal(result.stroke, "rgb(0, 0, 255)");
  assert.notEqual(result.body, "none");
  assert.equal(result.stylesheets, 0);
});
