import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, writeFile, readFile, realpath, copyFile, cp } from "node:fs/promises";
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
await writeFile(folder + "/slides.md", "---\nmarp: true\n---\n# Native CSP slides\n\n$E=mc^2$\n\n---\n\n# Next native slide");
await mkdir(folder + "/attachments", { recursive: true });
await writeFile(folder + "/attachments/notes.txt", "Disposable attachment");
await writeFile(folder + "/manifest.json", JSON.stringify({ format: "mdpkg", version: "2.0", entrypoint: "README.md", resources: [] }));
execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
  "Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory($env:MACA_NATIVE_FIXTURE, $env:MACA_NATIVE_ARCHIVE)"],
  { windowsHide: true, env: { ...process.env, MACA_NATIVE_FIXTURE: folder, MACA_NATIVE_ARCHIVE: archive } });
const archiveHash = createHash("sha256").update(await readFile(archive)).digest("hex");
const saveArchive = join(record, "approved-save.mdpkg");
const saveFolder = join(record, "approved-save-folder");
await copyFile(archive, saveArchive);
await cp(folder, saveFolder, { recursive: true });
// Seed only this disposable application's Rust-owned prior-selection record.
// This models reopening previously selected documents after restart; it does
// not add a production command that could grant paths from JavaScript.
const appData = join(process.env.LOCALAPPDATA, identifierExpected);
await mkdir(appData); // A fresh identifier must never reuse existing app data.
const canonical = async (path) => {
  const value = await realpath(path);
  return value.startsWith("\\\\?\\") ? value : "\\\\?\\" + value;
};
await writeFile(join(appData, "approved-documents.json"), JSON.stringify({ documents: [
  { path: await canonical(folder), directory: true }, { path: await canonical(archive), directory: false },
  { path: await canonical(saveArchive), directory: false }, { path: await canonical(saveFolder), directory: true },
] }));
const unselected = join(record, "unselected.mdpkg");
await copyFile(archive, unselected);
const unselectedHash = createHash("sha256").update(await readFile(unselected)).digest("hex");

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
  // Validate the sink independently: production connect-src must now block it.
  assert.equal(await (await fetch(origin + "/canary")).text(), "probe");
  requests.length = 0;
  const csp = await page.evaluate(async (origin) => {
    window.cspExecuted = false;
    const script = document.createElement("script"); script.textContent = "window.cspExecuted=true"; document.body.append(script);
    window.evalBlocked = false;
    const button = document.createElement("button"); button.id = "eval-probe"; button.textContent = "probe";
    button.addEventListener("click", () => {
      try { window.eval("window.cspExecuted=true"); } catch { window.evalBlocked = true; }
    });
    document.body.append(button);
    const fetchBlocked = await fetch(origin + "/blocked-by-csp").then(() => false, () => true);
    return { inlineBlocked: !window.cspExecuted, fetchBlocked };
  }, origin);
  await page.locator("#eval-probe").click();
  csp.evalBlocked = await page.evaluate(() => window.evalBlocked);
  assert.equal(await page.evaluate(() => window.cspExecuted), false);
  await page.locator("#eval-probe").evaluate((button) => button.remove());
  assert.deepEqual(csp, { inlineBlocked: true, evalBlocked: true, fetchBlocked: true });
  assert.deepEqual(requests, []);
  const deniedCommands = await page.evaluate(async ({ unselected, folder, appData }) => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const request = { path: unselected, manifest: { format: "mdpkg", version: "2.0", entrypoint: "README.md" },
      files: [{ path: "README.md", is_text: true, content: "canary overwrite", base64: null }], edit_history: null };
    const cases = [
      ["open_package", { path: unselected }], ["open_folder", { path: unselected + "-folder" }],
      ["save_package", { request }], ["save_folder", { request: { ...request, original_paths: [], expected_revision: "none" } }],
      ["create_new_package", { path: unselected }], ["create_empty_folder", { path: unselected + "-new" }],
      ["export_package", { request }], ["import_folder", { folder, dest: unselected }],
      ["export_folder", { packagePath: unselected, dest: unselected + "-export" }],
      ["watch_folder", { path: unselected + "-folder" }],
      ["clear_saved_edit_history", { path: unselected, kind: "package" }],
      ["read_image", { path: unselected }], ["read_attachment", { path: unselected }], ["save_attachment", { path: unselected, base64: "eA==" }],
      ["plugin:store|load", { path: unselected, options: {} }],
      ["save_attachment", { path: appData + "/approved-documents.json", base64: "e30=" }],
    ];
    const denied = [];
    for (const [command, args] of cases) {
      try { await invoke(command, args); } catch (error) {
        // Verify access denial, not merely malformed requests or a missing file.
        if (/requires selecting|application data|not allowed|not found/i.test(String(error))) denied.push(command);
        else throw new Error(`${command}: unexpected rejection ${error}`);
      }
    }
    if (denied.length !== cases.length) throw new Error(`Denied ${denied.length}/${cases.length} commands`);
    return denied;
  }, { unselected, folder, appData });
  const preferenceRoundtrip = await page.evaluate(async () => {
    const preferences = { vimMode: false, showToc: true, rspressMode: false,
      drawingPreferences: { gridVisible: true, snap: false, smartGuidesEnabled: true } };
    await window.__TAURI_INTERNALS__.invoke("save_editor_preferences", { preferences });
    const restored = await window.__TAURI_INTERNALS__.invoke("read_editor_preferences");
    return { expected: preferences, restored };
  });
  assert.deepEqual(preferenceRoundtrip.restored, preferenceRoundtrip.expected);
  const preferencesPersisted = true;
  const approvedOperations = await page.evaluate(async ({ saveArchive, saveFolder }) => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const pkg = await invoke("open_package", { path: saveArchive });
    pkg.files.find((file) => file.path === "README.md").content = "# Saved approved package";
    await invoke("save_package", { request: { path: saveArchive, manifest: pkg.manifest, files: pkg.files, edit_history: null } });
    const saved = await invoke("open_package", { path: saveArchive });
    const folder = await invoke("open_folder", { path: saveFolder });
    folder.files.find((file) => file.path === "README.md").content = "# Saved approved folder";
    await invoke("save_folder", { request: { path: saveFolder, manifest: folder.manifest, files: folder.files, edit_history: null,
      original_paths: folder.files.map((file) => file.path), expected_revision: folder.folder_revision } });
    const reloaded = await invoke("open_folder", { path: saveFolder });
    await invoke("watch_folder", { path: saveFolder });
    await invoke("stop_watching_folder");
    return { packageSaved: saved.files.find((file) => file.path === "README.md").content === "# Saved approved package",
      folderSaved: reloaded.files.find((file) => file.path === "README.md").content === "# Saved approved folder", watcherInstalled: true };
  }, { saveArchive, saveFolder });
  assert.deepEqual(approvedOperations, { packageSaved: true, folderSaved: true, watcherInstalled: true });
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
    await page.locator('[data-path="slides.md"]').click();
    const marp = page.frameLocator("iframe");
    await marp.getByRole("heading", { name: "Native CSP slides", exact: true }).waitFor();
    assert.equal(await marp.locator("mjx-container svg").count(), 1);
    assert.equal(await marp.locator("body").evaluate(() => typeof window.__TAURI_INTERNALS__), "undefined");
    await page.getByRole("button", { name: "次のスライド", exact: true }).click();
    await marp.getByRole("heading", { name: "Next native slide", exact: true }).waitFor();
    results.push({ mode, blockedLinks: prefixes.length, svgRequests: requests.length - before, svgNavigationBlocked: true, enlarged: true, internalNavigation: true, localSvgReferencesPreserved: true, marpMathAndNavigation: true });
  }
  assert.equal(await readFile(folder + "/diagram.svg", "utf8"), svg);
  assert.equal(createHash("sha256").update(await readFile(archive)).digest("hex"), archiveHash);
  assert.equal(createHash("sha256").update(await readFile(unselected)).digest("hex"), unselectedHash);
  const result = { identifier, webviewProfile, executableSha256: createHash("sha256").update(await readFile(executable)).digest("hex"), engine: await browser.version(), userAgent: await page.evaluate(() => navigator.userAgent), loopbackCanaryPassed: true, csp, deniedCommands, preferencesPersisted, approvedOperations, results, originalSvgUnchanged: true, originalArchiveUnchanged: true, unauthorizedCanaryUnchanged: true, attackToIpcTested: false };
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
