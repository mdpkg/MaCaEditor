import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright";

const config = JSON.parse(await readFile(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
const csp = config.app.security.csp;
const source = await readFile(new URL("../../src/lib/marp/frameRuntime.js", import.meta.url));
const runtimeHash = `'sha256-${createHash("sha256").update(source).digest("base64")}'`;
let browser, server, sink, origin, sinkOrigin;
const leaked = [];
before(async () => {
  assert.equal(typeof csp, "string", "production CSP must be configured");
  const result = await build({ configFile: false, logLevel: "error", plugins: [react()],
    define: { "process.env.NODE_ENV": '"production"' },
    build: { write: false, minify: false, assetsInlineLimit: 0,
      rollupOptions: { input: fileURLToPath(new URL("./cspFixture.tsx", import.meta.url)), preserveEntrySignatures: "strict",
        output: { format: "iife", name: "MacaCsp", inlineDynamicImports: true } } },
  });
  const output = (Array.isArray(result) ? result[0] : result).output;
  const bundle = output.find((item) => item.type === "chunk").code;
  const stylesheet = await readFile(new URL("../../src/styles.css", import.meta.url));
  server = createServer((req, res) => {
    res.setHeader("Content-Security-Policy", req.url === "/dev" ? config.app.security.devCsp : csp);
    if (req.url === "/dev") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end('<!doctype html><script>window.devRefreshAllowed=true</script>'); return;
    }
    if (req.url === "/bundle.js") { res.setHeader("Content-Type", "text/javascript; charset=utf-8"); res.end(bundle); return; }
    if (req.url === "/styles.css") { res.setHeader("Content-Type", "text/css; charset=utf-8"); res.end(stylesheet); return; }
    const asset = output.find((item) => "/" + item.fileName === req.url);
    if (asset) { res.setHeader("Content-Type", req.url.endsWith(".js") ? "text/javascript" : "application/octet-stream"); res.end(asset.source); return; }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/styles.css"><div id="app" style="height:700px"></div><script src="/bundle.js"></script>');
  });
  sink = createServer((req, res) => { leaked.push(req.url); res.setHeader("Access-Control-Allow-Origin", "*"); res.end("canary"); });
  await Promise.all([new Promise((r) => server.listen(0, "127.0.0.1", r)), new Promise((r) => sink.listen(0, "127.0.0.1", r))]);
  origin = `http://127.0.0.1:${server.address().port}`;
  sinkOrigin = `http://127.0.0.1:${sink.address().port}`;
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  if (server) await new Promise((r) => server.close(r));
  if (sink) await new Promise((r) => sink.close(r));
});

test("CSP permits only the fixed Marp helper hash, never arbitrary inline/eval scripts", () => {
  const script = csp.split(";").find((part) => part.trim().startsWith("script-src "));
  assert.ok(script.includes(runtimeHash), "CSP hash must match the exact retained runtime source");
  assert.ok(!script.includes("'unsafe-inline'") && !script.includes("'unsafe-eval'"));
  for (const directive of ["object-src 'none'", "base-uri 'none'", "form-action 'none'"]) assert.ok(csp.includes(directive));
});

test("development CSP permits Vite's inline refresh without weakening production policy", async (t) => {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.goto(origin + "/dev");
  assert.equal(await page.evaluate(() => window.devRefreshAllowed), true);
  assert.ok(config.app.security.devCsp.includes("ws://localhost:1420"));
  assert.ok(!config.app.security.devCsp.includes("'unsafe-eval'"));
});

test("production CSP blocks executable injection and external network/frames", async (t) => {
  const page = await browser.newPage();
  page.on("pageerror", (error) => t.diagnostic(error.message));
  t.after(() => page.close());
  await page.goto(origin);
  await page.waitForFunction(() => window.MacaCsp);
  // Prove that the loopback sink works, then verify denial from the protected page.
  assert.equal(await (await fetch(sinkOrigin + "/canary")).text(), "canary");
  leaked.length = 0;
  const result = await page.evaluate(async (sink) => {
    window.cspProbe = false;
    const script = document.createElement("script"); script.textContent = "window.cspProbe=true"; document.body.append(script);
    window.evalDenied = false;
    const button = document.createElement("button"); button.id = "eval-probe"; button.textContent = "probe";
    button.addEventListener("click", () => {
      try { window.eval("window.cspProbe=true"); } catch { window.evalDenied = true; }
    });
    document.body.append(button);
    const image = new Image(); image.src = sink + "/image"; document.body.append(image);
    const frame = document.createElement("iframe"); frame.src = sink + "/frame"; document.body.append(frame);
    const style = document.createElement("style"); style.textContent = `@import '${sink}/style';`; document.head.append(style);
    const network = await fetch(sink + "/fetch").then(() => true, () => false);
    await new Promise((r) => setTimeout(r, 200));
    return { executed: window.cspProbe, network };
  }, sinkOrigin);
  // A real event avoids CDP's own privileged unsafe-eval exemption.
  await page.locator("#eval-probe").click();
  assert.deepEqual(result, { executed: false, network: false });
  assert.equal(await page.evaluate(() => window.evalDenied), true);
  assert.equal(await page.evaluate(() => window.cspProbe), false);
  assert.deepEqual(leaked, []);
});

test("CSP retains Marp sandbox, offline diagrams including wasm, and print pagination", { timeout: 120_000 }, async (t) => {
  const page = await browser.newPage();
  page.on("pageerror", (error) => t.diagnostic(error.message));
  page.on("console", (message) => { if (message.type() === "error") t.diagnostic(message.text().slice(0, 600)); });
  page.setDefaultTimeout(30_000);
  t.after(() => page.close());
  await page.goto(origin);
  await page.waitForFunction(() => window.MacaCsp);
  await page.evaluate(() => window.MacaCsp.mount("---\nmarp: true\n---\n# CSP slides\n\n$E=mc^2$", [], false));
  const frame = page.frameLocator("iframe");
  await frame.getByRole("heading", { name: "CSP slides", exact: true }).waitFor();
  assert.equal(await page.locator("iframe").getAttribute("sandbox"), "allow-scripts");
  assert.equal(await frame.locator("body").evaluate(() => typeof window.__TAURI_INTERNALS__), "undefined");
  const diagrams = await page.evaluate(async () => {
    const { renderPlantUml, renderMermaid, renderMathJax } = window.MacaCsp;
    return Promise.all([renderPlantUml("@startuml\nAlice -> Bob: CSP\n@enduml"), renderMermaid("graph LR; A-->B"), renderMathJax("E=mc^2")]);
  });
  for (const svg of diagrams) assert.ok(svg.includes("<svg"));
  assert.ok(await page.evaluate(() => window.MacaCsp.paginate()) > 0);
});
