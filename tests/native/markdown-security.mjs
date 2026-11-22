import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { createServer as createPortReservation } from "node:net";
import { resolve, join } from "node:path";
import { chromium } from "playwright";

assert.equal(process.platform, "win32", "Use scripts/test-markdown-webview2.ps1 on Windows");
const identifierExpected = process.env.MACA_NATIVE_TEST_ID;
assert.match(identifierExpected ?? "", /^com\.maca\.markdownsecurityprobe\.run[a-f\d]{32}$/);
assert.ok(process.env.MACA_NATIVE_TEST_OUTPUT && process.env.MACA_NATIVE_TEST_EXE, "Use the PowerShell runner to build an isolated instance");
const record = resolve(process.env.MACA_NATIVE_TEST_OUTPUT);
const executable = resolve(process.env.MACA_NATIVE_TEST_EXE);
assert.equal(executable, join(record, "maca-markdown-security-probe.exe"));
const folder = record + "/native-fixture";
const archive = record + "/native-fixture.mdpkg";
const requests = [];
const server = createServer((req, res) => { requests.push(req.url); res.setHeader("Access-Control-Allow-Origin", "*"); res.end("probe"); });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
server.unref(); // Setup failures must not leave the diagnostic server running.
const origin = `http://127.0.0.1:${server.address().port}`;
await mkdir(folder, { recursive: true });
const prefixes = ["java\tscript:", "java%09script:", "java%0Ascript:", " javascript:", "java%0Dscript:", "javascript:",
  "java%2509script:", "%00javascript:", "JaVaScRiPt:", "data:text/html,", "vbscript:", "file:///", "blob:http://127.0.0.1/"];
const markdown = "# Native security probe\n\n" + prefixes.map((prefix, i) => `[probe-${i}](<${prefix}window.__nativeProbe=true>)`).join("\n\n")
  + "\n\n![diagram](diagram.svg)\n\n[guide](guide.md)\n\n[attachment](attachments/notes.txt)";
const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="180" height="120">
<defs><linearGradient id="g"><stop stop-color="red"/></linearGradient><rect id="shape" width="10" height="10"/>
<clipPath id="clip"><rect width="10" height="10"/></clipPath><mask id="mask"><rect width="10" height="10" fill="white"/></mask>
<filter id="filter"><feGaussianBlur stdDeviation="0"/></filter><marker id="marker"><path d="M0 0L2 2"/></marker><pattern id="pattern" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10"/></pattern></defs>
<image href="${origin}/image" width="10" height="10"/><image xlink:href="${origin}/ximage" width="10" height="10"/>
<use href="${origin}/use.svg#id"/><use xlink:href="${origin}/xuse.svg#id"/><feImage href="${origin}/fe-image"/>
<a href="${origin}/nav"><text y="40">svg nav</text></a><a xlink:href="${origin}/xnav"><text y="65">xlink nav</text></a>
<rect width="10" height="10" fill="url(#g)" filter="url(${origin}/filter#f)"/><rect src="${origin}/src" mask="url(${origin}/mask#x)" clip-path="url(${origin}/clip#x)"/>
<use href="#shape"/><use xlink:href="#shape"/><a href="#shape"><text y="90">local nav</text></a>
<rect id="local-references" fill="url(#g)" stroke="url(#pattern)" filter="url(#filter)" mask="url(#mask)" clip-path="url(#clip)" marker-start="url(#marker)"/>
<rect style="fill:url(${origin}/css-image)"/><rect style="background-image:image-set(&quot;${origin}/css-string&quot; 1x)"/>
<style>@import '${origin}/css-import'; @font-face {font-family:external;src:url(${origin}/font)}</style>
<foreignObject><img xmlns="http://www.w3.org/1999/xhtml" src="${origin}/foreign-image"/></foreignObject>
<a href="java&#9;script:window.__nativeProbe=true"><text y="110">script nav</text></a>
</svg>`;
await writeFile(folder + "/README.md", markdown);
await writeFile(folder + "/diagram.svg", svg);
await writeFile(folder + "/guide.md", "# Native guide");
await mkdir(folder + "/attachments", { recursive: true });
await writeFile(folder + "/attachments/notes.txt", "Disposable attachment");
await writeFile(folder + "/manifest.json", JSON.stringify({ format: "mdpkg", version: "2.0", entrypoint: "README.md", resources: [] }));
execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
  "Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory($env:MACA_NATIVE_FIXTURE, $env:MACA_NATIVE_ARCHIVE)"],
  { windowsHide: true, env: { ...process.env, MACA_NATIVE_FIXTURE: folder, MACA_NATIVE_ARCHIVE: archive } });
const archiveHash = createHash("sha256").update(await readFile(archive)).digest("hex");

// Select a fresh loopback port instead of attaching to an existing debug-enabled
// user application. Verify the unique app identifier before using its storage.
const reservation = createPortReservation();
await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
const cdpPort = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const cdpUrl = `http://127.0.0.1:${cdpPort}`;
const webviewProfile = join(record, "webview2-profile");
await mkdir(webviewProfile); // Fail rather than reuse any existing browser data.
const child = spawn(executable, [], {
  windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: webviewProfile,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdpPort} --remote-debugging-address=127.0.0.1` },
});
let nativeOutput = "";
let spawnError;
child.on("error", (error) => { spawnError = error; });
child.stdout.on("data", (data) => { nativeOutput += data; });
child.stderr.on("data", (data) => { nativeOutput += data; });
let browser;
try {
  let endpoint;
  for (let i = 0; i < 120; i++) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) {
      const status = `0x${(child.exitCode >>> 0).toString(16).padStart(8, "0")}`;
      throw new Error(`Native exited (${status}): ${nativeOutput}. For 0xc0000139 check the probe's Common Controls v6 manifest; see docs/markdown-preview-security.md.`);
    }
    try { endpoint = await fetch(cdpUrl + "/json/version", { signal: AbortSignal.timeout(500) }).then((r) => r.json()); break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(endpoint, "Dedicated native CDP endpoint must start");
  browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0];
  const page = context.pages()[0];
  page.setDefaultTimeout(15_000);
  await page.waitForFunction(() => window.__TAURI_INTERNALS__);
  const identifier = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("plugin:app|identifier"));
  assert.equal(identifier, identifierExpected);
  const canary = await page.evaluate((origin) => fetch(origin + "/canary").then((r) => r.text()), origin);
  assert.equal(canary, "probe");
  assert.deepEqual(requests, ["/canary"]);
  requests.length = 0;
  await page.evaluate(({ folder, archive }) => localStorage.setItem("maca.recentDocuments", JSON.stringify([
    { path: folder, kind: "folder" }, { path: archive, kind: "package" },
  ])), { folder, archive });
  const results = [];
  for (const [mode, path] of [["folder", folder], ["package", archive]]) {
    await page.reload();
    const before = requests.length;
    await page.getByRole("button", { name: path, exact: true }).click();
    await page.locator(".markdown-preview").getByRole("heading", { name: "Native security probe", exact: true }).waitFor();
    for (let i = 0; i < prefixes.length; i++) {
      await page.evaluate(() => { window.__nativeProbe = false; });
      const link = page.getByRole("link", { name: `probe-${i}`, exact: true });
      assert.equal(await link.getAttribute("href"), "#");
      assert.notEqual(await link.evaluate((a) => a.protocol), "javascript:");
      await link.click();
      await page.waitForTimeout(50);
      assert.equal(await page.evaluate(() => window.__nativeProbe), false);
    }
    const appUrl = page.url();
    for (const label of ["svg nav", "xlink nav", "script nav"]) {
      await page.getByText(label, { exact: true }).evaluate((text) => text.parentElement.addEventListener("click", (e) => e.stopPropagation()));
      await page.getByText(label, { exact: true }).click();
      await page.waitForTimeout(50);
      assert.equal(page.url(), appUrl);
      assert.equal(await page.evaluate(() => window.__nativeProbe), false);
    }
    await page.locator('.preview-diagram-content rect[width="10"][fill="url(#g)"]').click();
    await page.locator('.preview-media-overlay use[href="#shape"]').waitFor();
    await page.waitForTimeout(200);
    assert.deepEqual(requests.slice(before), []);
    for (const selector of [".preview-diagram-content", ".preview-media-overlay"]) {
      assert.equal(await page.locator(selector + " svg").evaluate((svg, origin) => svg.outerHTML.includes(origin), origin), false);
      const refs = page.locator(selector + " #local-references");
      for (const [attr, id] of [["fill", "g"], ["stroke", "pattern"], ["filter", "filter"], ["mask", "mask"], ["clip-path", "clip"], ["marker-start", "marker"]]) {
        assert.equal(await refs.getAttribute(attr), `url(#${id})`);
      }
      assert.equal(await page.locator(selector + " foreignObject, " + selector + " style").count(), 0);
    }
    await page.screenshot({ path: record + `/native-${mode}-enlarged.png` });
    await page.keyboard.press("Escape");
    await page.getByRole("link", { name: "guide", exact: true }).click();
    await page.locator(".markdown-preview").getByRole("heading", { name: "Native guide", exact: true }).waitFor();
    results.push({ mode, blockedLinks: prefixes.length, svgRequests: requests.length - before, svgNavigationBlocked: true, enlarged: true, internalNavigation: true, localSvgReferencesPreserved: true });
  }
  assert.equal(await readFile(folder + "/diagram.svg", "utf8"), svg);
  assert.equal(createHash("sha256").update(await readFile(archive)).digest("hex"), archiveHash);
  const result = { identifier, webviewProfile, executableSha256: createHash("sha256").update(await readFile(executable)).digest("hex"), engine: await browser.version(), userAgent: await page.evaluate(() => navigator.userAgent), loopbackCanaryPassed: true, results, originalSvgUnchanged: true, originalArchiveUnchanged: true, attackToIpcTested: false };
  await writeFile(record + "/native-result.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await writeFile(record + "/native-failure.json", JSON.stringify({ message: error.message, stack: error.stack }, null, 2));
  throw error;
} finally {
  try { await browser?.close(); } finally {
    if (!spawnError && child.exitCode === null && child.signalCode === null) {
      const stopped = once(child, "exit");
      child.kill();
      await stopped;
    }
    await writeFile(record + "/native-output.log", nativeOutput);
    await new Promise((resolve) => server.close(resolve));
  }
}
