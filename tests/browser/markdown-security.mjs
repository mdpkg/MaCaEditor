import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright";

let browser, bundle, server, origin;
const requests = [];
before(async () => {
  server = createServer((req, res) => {
    requests.push(req.url);
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end('<!doctype html><div id="app"></div>');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  const result = await build({ configFile: false, logLevel: "error", plugins: [react()],
    define: { "process.env.NODE_ENV": '"production"' }, build: { write: false,
      lib: { entry: fileURLToPath(new URL("./markdownFixture.tsx", import.meta.url)), name: "MacaMarkdown", formats: ["iife"] },
    } });
  bundle = (Array.isArray(result) ? result[0] : result).output.find((item) => item.type === "chunk").code;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); await new Promise((resolve) => server?.close(resolve)); });

async function fixture(t) {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.route("**/*", (route) => route.request().url().startsWith(origin + "/") ? route.continue() : route.abort());
  await page.goto(origin);
  await page.addScriptTag({ content: bundle });
  return page;
}

test("Markdown obfuscated links never execute when clicked", async (t) => {
  const page = await fixture(t);
  const urls = ["java\tscript:", "java%09script:", "java%0Ascript:", " javascript:", "java%0Dscript:",
    "javascript:", "JaVaScRiPt:", "java%2509script:", "%256aavascript:", "%00javascript:"];
  const outcomes = [];
  for (const [index, prefix] of urls.entries()) {
    const label = `probe-${index}`;
    await page.evaluate(({ url, label }) => {
      window.__probe = false;
      window.MacaMarkdown.mount(`[${label}](<${url}window.__probe=true>)`);
    }, { url: prefix, label });
    const link = page.getByRole("link", { name: label, exact: true });
    await link.click();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    outcomes.push(await link.evaluate((a) => ({ executed: window.__probe, href: a.getAttribute("href"), protocol: a.protocol })));
  }
  assert.deepEqual(outcomes.map((value) => value.executed), urls.map(() => false));
  for (const outcome of outcomes) {
    assert.equal(outcome.href, "#");
    assert.notEqual(outcome.protocol, "javascript:");
  }
});

test("SVG rendering and enlargement cannot request resources or navigate", async (t) => {
  const page = await fixture(t);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="150" height="100">
    <defs><linearGradient id="gradient"><stop stop-color="red"/></linearGradient><rect id="shape" width="5" height="5"/></defs>
    <image href="${origin}/svg-img.png" width="10" height="10"/>
    <image xlink:href="${origin}/svg-xlink.png" width="10" height="10"/>
    <use href="${origin}/external.svg#x"/><use xlink:href="${origin}/external-x.svg#x"/>
    <a href="${origin}/svg-nav"><text y="30">svg nav</text></a>
    <a xlink:href="${origin}/svg-xnav"><text y="60">xlink nav</text></a>
    <rect width="10" height="10" fill="url(#gradient)" filter="url(${origin}/filter.svg#x)"/>
    <use href="#shape"/><style>@import '${origin}/style.css'; @font-face {font-family:evil;src:url(${origin}/font.woff)}</style>
    <text style="fill:url(${origin}/css.png)">css</text>
    <foreignObject><img xmlns="http://www.w3.org/1999/xhtml" src="${origin}/foreign.png"/></foreignObject>
  </svg>`;
  await page.evaluate((svg) => window.MacaMarkdown.mount("![diagram](diagram.svg)", [
    { path: "diagram.svg", is_text: true, content: svg, base64: null },
  ]), svg);
  await page.locator(".preview-diagram-content svg").waitFor();
  await page.waitForTimeout(200);
  t.diagnostic(`SVG resource requests: ${requests.filter((url) => /svg-|external|filter|css|style|font|foreign/.test(url)).join(", ")}`);
  // Exercise a real SVG navigation independently of the enlargement handler.
  await page.locator(".preview-diagram-content a").first().evaluate((a) => a.addEventListener("click", (e) => e.stopPropagation()));
  await page.getByText("svg nav", { exact: true }).click();
  assert.equal(page.url(), origin + "/", "SVG anchor must not navigate");
  await page.locator(".preview-diagram-content").click({ position: { x: 140, y: 90 } });
  await page.locator(".preview-media-overlay svg").waitFor();
  await page.waitForTimeout(200);
  for (const selector of [".preview-diagram-content svg", ".preview-media-overlay svg"]) {
    assert.equal(await page.locator(selector + ' use[href="#shape"]').count(), 1);
    assert.equal(await page.locator(selector + ' rect[fill="url(#gradient)"]').count(), 1);
    assert.equal(await page.locator(selector + ' [href^="http"], ' + selector + ' [filter^="url(http"]').count(), 0);
  }
  assert.deepEqual(requests.filter((url) => /svg-|external|filter|css|style|font|foreign/.test(url)), []);
});
