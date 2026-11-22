// Optional native smoke check. Launch this task's Tauri custom-protocol build
// with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9224 first.
// Open example/marp-example as a folder or package through the native picker first.
import assert from "node:assert/strict";
import { chromium } from "playwright";

if (process.platform !== "win32") throw new Error("Requires Windows and a running debug-enabled Tauri build with the Marp example open.");
const browser = await chromium.connectOverCDP("http://127.0.0.1:9224");
try {
  const context = browser.contexts()[0];
  const page = context.pages().find((page) => page.url().includes("tauri.localhost"));
  assert.ok(page, "Tauri production page must exist");
  page.setDefaultTimeout(15_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  if (await page.locator(".empty-state").count()) {
    assert.ok(process.env.MACA_MARP_PACKAGE, "Open the example with the native picker first, or set its exact recent-document path");
    await page.locator(".empty-state").getByRole("button", { name: process.env.MACA_MARP_PACKAGE, exact: true }).click();
  }
  else await page.locator('[data-path="slides.md"]').click();
  const frame = page.frameLocator("iframe");
  await frame.getByRole("heading", { name: "Marp プレビュー", exact: true }).waitFor();
  assert.equal(await page.locator("iframe").getAttribute("sandbox"), "allow-scripts");
  const isolation = await frame.locator("body").evaluate(() => ({
    tauri: typeof window.__TAURI_INTERNALS__, ipc: typeof window.ipc,
    scripts: document.querySelectorAll("script").length,
    csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]').content,
  }));
  assert.equal(isolation.tauri, "undefined");
  assert.equal(isolation.ipc, "undefined");
  assert.equal(isolation.scripts, 1);
  assert.ok(isolation.csp.includes("connect-src 'none'"));
  await page.getByRole("button", { name: "次のスライド" }).click();
  await page.getByText("2 / 4", { exact: true }).waitFor();
  assert.equal(await frame.locator("mjx-container svg").count(), 1);
  assert.ok((await frame.locator('img[src^="data:image/svg+xml"]').count()) > 0);
  await page.getByRole("button", { name: "次のスライド" }).click();
  await page.getByText("3 / 4", { exact: true }).waitFor();
  assert.ok(await frame.locator("figure").evaluate((element) => getComputedStyle(element).backgroundImage.includes("data:image/svg+xml")));
  await page.getByRole("button", { name: "ファイル", exact: true }).click();
  const print = page.getByRole("menuitem", { name: "印刷", exact: true });
  assert.equal(await print.isDisabled(), true);
  assert.ok((await print.getAttribute("title")).includes("Marp"));
  await page.keyboard.press("Escape");
  await page.locator('[data-path="gaia.md"]').click();
  await frame.getByRole("heading", { name: "Gaia — 4:3", exact: true }).waitFor();
  assert.equal(await frame.locator("svg[data-marpit-svg]").first().getAttribute("viewBox"), "0 0 960 720");
  await page.locator('[data-path="uncover.md"]').click();
  await frame.getByRole("heading", { name: "Uncover", exact: true }).waitFor();
  assert.equal(await frame.locator("svg[data-marpit-svg]").first().getAttribute("viewBox"), "0 0 1280 720");
  assert.deepEqual(errors, []);
  if (process.env.MACA_MARP_SCREENSHOT) await page.screenshot({ path: process.env.MACA_MARP_SCREENSHOT });
  console.log(JSON.stringify({ engine: await browser.version(), url: page.url(), isolation, themes: ["default", "gaia", "uncover"], sizes: ["16:9", "4:3"], math: true, svg: true, background: true, printingDisabled: true, errors }, null, 2));
} finally { await browser.close(); }
