import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { chromium } from "playwright";
import react from "@vitejs/plugin-react";
import { readFile } from "node:fs/promises";

let browser;
let bundle;
before(async () => {
  const result = await build({ configFile: false, logLevel: "error", plugins: [react()], define: { "process.env.NODE_ENV": '"production"' }, build: {
    write: false,
    lib: { entry: fileURLToPath(new URL("./marpFixture.tsx", import.meta.url)), name: "MacaMarpFrame", formats: ["iife"] },
  } });
  bundle = (Array.isArray(result) ? result[0] : result).output.find((item) => item.type === "chunk").code;
  browser = await chromium.launch({ args: ["--enable-precise-memory-info"] });
});

async function fixture(t, options = {}) {
  const page = await browser.newPage(options);
  page.setDefaultTimeout(5000);
  page.on("pageerror", (error) => t.diagnostic(error.stack));
  t.after(() => page.close());
  await page.setContent('<!doctype html><html><body><div id="app" style="height:700px"></div></body></html>');
  await page.addStyleTag({ content: await readFile(new URL("../../src/styles.css", import.meta.url), "utf8") });
  await page.addScriptTag({ content: bundle });
  return page;
}

test("standard themes, 4:3/16:9, MathJax, sanitized SVG and backgrounds render offline at high DPI", async (t) => {
  const page = await fixture(t, { deviceScaleFactor: 2 });
  const requests = [];
  page.on("request", (request) => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  for (const theme of ["default", "gaia", "uncover"]) {
    await page.evaluate((theme) => window.MacaMarpFrame.mount(`---\nmarp: true\ntheme: ${theme}\nsize: 4:3\npaginate: true\nheader: Header\nfooter: Footer\n---\n# ${theme}\n$x^2$\n\n![bg](images/d.svg)\n\n---\n# Next`, [
      { path: "images/d.svg", is_text: true, base64: null, content: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#e2f3ff"/><script>parent.attacked=true</script><image href="https://invalid.test/image"/></svg>' },
    ], false), theme);
    const frame = page.frameLocator("iframe");
    await frame.locator("section h1").first().waitFor();
    assert.equal(await frame.locator("mjx-container svg").count(), 1);
    assert.ok(await frame.locator("figure").evaluate((element) => getComputedStyle(element).backgroundImage.startsWith('url("data:image/svg+xml;base64,')));
    const size = await frame.locator("svg[data-marpit-svg]").first().boundingBox();
    assert.ok(Math.abs(size.width / size.height - 4 / 3) < 0.01);
    await page.setViewportSize({ width: 800, height: 900 });
    const resized = await frame.locator("svg[data-marpit-svg]").first().boundingBox();
    assert.ok(Math.abs(resized.width / resized.height - 4 / 3) < 0.01);
    await page.getByRole("button", { name: "次のスライド" }).click();
    await page.getByText("2 / 2", { exact: true }).waitFor();
  }
  assert.deepEqual(requests, []);
  assert.equal(await page.evaluate(() => window.attacked), undefined);
});

test("real CodeMirror and iframe synchronize by slide, retain positions on edits and route links", async (t) => {
  const page = await fixture(t);
  const source = '---\nmarp: true\n---\n' + Array.from({ length: 12 }, (_, index) => `# Slide ${index + 1}\n\n${"Paragraph text.\n\n".repeat(10)}`).join('\n---\n');
  await page.evaluate((source) => window.MacaMarpFrame.mount(source), source);
  const frame = page.frameLocator("iframe");
  await frame.locator("section h1").first().waitFor();
  const second = source.indexOf("---\n# Slide 2");
  await page.evaluate((offset) => window.MacaMarpFrame.scrollEditor(offset), second);
  await page.getByText("2 / 12", { exact: true }).waitFor();
  await page.getByRole("button", { name: "次のスライド" }).click();
  await page.getByText("3 / 12", { exact: true }).waitFor();
  await page.waitForFunction((offset) => Math.abs(window.MacaMarpFrame.editorOffset() - offset) < 10, source.indexOf("---\n# Slide 3"));
  const scrolled = await page.evaluate(() => window.MacaMarpFrame.editorOffset());
  await frame.locator("article").nth(4).evaluate((element) => element.scrollIntoView());
  await page.getByText("5 / 12", { exact: true }).waitFor();
  await page.waitForFunction((offset) => window.MacaMarpFrame.editorOffset() > offset, scrolled);
  await page.evaluate((source) => window.MacaMarpFrame.replaceSource(source.replace("# Slide 2", "# Inserted\n\n---\n# Slide 2")), source);
  await page.getByText("6 / 13", { exact: true }).waitFor();
  await page.evaluate(() => window.MacaMarpFrame.replaceSource('---\nmarp: true\n---\n# Links\n[Next](#target)\n[Document](other.md)\n[Attachment](attachments/a.txt)\n\n---\n# Target'));
  await frame.getByRole("link", { name: "Next", exact: true }).click();
  await page.getByText("2 / 2", { exact: true }).waitFor();
  // Reload with package link targets, then use the same existing callbacks.
  await page.evaluate(() => window.MacaMarpFrame.mount('---\nmarp: true\n---\n[Document](other.md)\n[Attachment](attachments/a.txt)', [
    { path: "other.md", content: "# Other", is_text: true, base64: null },
    { path: "attachments/a.txt", content: "File", is_text: true, base64: null },
  ]));
  await frame.getByRole("link", { name: "Document", exact: true }).click();
  await frame.getByRole("link", { name: "Attachment", exact: true }).click();
  await page.waitForFunction(() => window.MacaMarpFrame.actions.length === 2);
  assert.deepEqual(await page.evaluate(() => [...window.MacaMarpFrame.actions]), ["other.md", "attachments/a.txt"]);
});

test("measures small, medium and large conversion and event-loop delay", async (t) => {
  const page = await fixture(t);
  const measurements = await page.evaluate(async () => {
    const measurements = [];
    // Warm up the bundled compiler and theme machinery separately from samples.
    window.MacaMarpFrame.renderMarp("# Warmup", "", []);
    for (const count of [5, 50, 200]) {
      const source = '---\nmarp: true\n---\n' + Array.from({ length: count }, (_, index) => `# Slide ${index}\n\n日本語 paragraph\n\n- A\n- B`).join('\n---\n');
      const heapBefore = performance.memory?.usedJSHeapSize;
      const start = performance.now();
      const pending = new Promise((resolve) => setTimeout(() => resolve(performance.now() - start), 0));
      const result = window.MacaMarpFrame.renderMarp(source, "", []);
      const conversionMs = performance.now() - start;
      measurements.push({ count, conversionMs: Math.round(conversionMs), eventLoopDelayMs: Math.round(await pending), heapBefore, heapAfter: performance.memory?.usedJSHeapSize, outputBytes: result.html.length + result.css.length });
    }
    return measurements;
  });
  t.diagnostic(JSON.stringify(measurements));
  assert.deepEqual(measurements.map((value) => value.count), [5, 50, 200]);
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
