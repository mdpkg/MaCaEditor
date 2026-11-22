import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { chromium } from "playwright";

let browser;
let bundle;
before(async () => {
  const result = await build({ configFile: false, logLevel: "error", build: {
    write: false,
    lib: { entry: fileURLToPath(new URL("../../src/lib/marp/frame.ts", import.meta.url)), name: "MacaMarpFrame", formats: ["iife"] },
  } });
  bundle = (Array.isArray(result) ? result[0] : result).output.find((item) => item.type === "chunk").code;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); });

test("opaque iframe executes only the fixed helper, blocks navigation and external resources", async (t) => {
  const page = await browser.newPage();
  t.after(() => page.close());
  const requests = [];
  page.on("requestfinished", (request) => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  const failures = [];
  page.on("requestfailed", (request) => failures.push(request.failure()?.errorText));
  await page.setContent("<!doctype html><body><main>Application</main></body>");
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => {
    window.messages = [];
    window.addEventListener("message", (event) => {
      window.messages.push({ ...event.data, origin: event.origin });
    });
    const frame = document.createElement("iframe");
    frame.sandbox = "allow-scripts";
    frame.srcdoc = window.MacaMarpFrame.createFrameShell("probe");
    document.body.append(frame);
  });
  await page.waitForFunction(() => window.messages.some((message) => message.type === "ready"));
  await page.evaluate(() => document.querySelector("iframe").contentWindow.postMessage({
    channel: "maca-marp", session: "probe", generation: 1, type: "render", index: 0,
    html: '<article data-slide-index="0"><h1 id="one">Slide</h1><script>parent.attacked=true</script><img src="https://invalid.test/image" onerror="parent.attacked=true"><a href="https://invalid.test/link">Link</a></article>',
    css: '@import "https://invalid.test/style"; h1{color:rgb(255,0,0)}',
  }, "*"));
  await page.waitForFunction(() => window.messages.some((message) => message.type === "rendered"));
  const frame = page.frames()[1];
  await frame.getByText("Link", { exact: true }).click();
  await page.waitForFunction(() => window.messages.some((message) => message.type === "link"));
  assert.equal(await page.evaluate(() => window.attacked), undefined);
  assert.equal(await frame.evaluate(() => getComputedStyle(document.querySelector("h1")).color), "rgb(255, 0, 0)");
  assert.notEqual(await page.locator("main").evaluate((element) => getComputedStyle(element).color), "rgb(255, 0, 0)");
  assert.equal(await page.evaluate(() => window.messages[0].origin), "null");
  assert.equal(frame.url(), "about:srcdoc");
  assert.deepEqual(requests, []);
  assert.equal(failures.length, 2);
  assert.ok(failures.every((reason) => reason.includes("csp")));
});
