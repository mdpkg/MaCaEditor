import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright";

let browser, bundle;
before(async () => {
  const result = await build({ configFile: false, logLevel: "error", plugins: [react()], define: { "process.env.NODE_ENV": '"production"' },
    build: { write: false, lib: { entry: fileURLToPath(new URL("./chachaFixture.tsx", import.meta.url)), name: "MacaChacha", formats: ["iife"] } } });
  bundle = (Array.isArray(result) ? result[0] : result).output.find((item) => item.type === "chunk").code;
  browser = await chromium.launch();
});
after(async () => browser?.close());
async function fixture(t, viewport = { width: 900, height: 700 }, options = {}) {
  const page = await browser.newPage({ viewport }); t.after(() => page.close());
  page.setDefaultTimeout(5000);
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") t.diagnostic(message.text()); });
  t.after(() => assert.deepEqual(errors, []));
  await page.setContent('<!doctype html><meta charset="utf-8"><div id="app" style="height:100vh"></div>');
  await page.addStyleTag({ content: await readFile(new URL("../../src/styles.css", import.meta.url), "utf8") });
  await page.addScriptTag({ content: bundle });
  await page.evaluate((options) => window.MacaChacha.mount(options), options);
  await page.locator(".cm-content").waitFor();
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  return page;
}
for (const width of [900, 360]) {
  test(`茶々入れは${width}px幅で本文・折返し・選択を保ち引用会話を開ける`, async (t) => {
    const page = await fixture(t, { width, height: 700 });
    await page.emulateMedia({ colorScheme: width === 360 ? "dark" : "light" });
    await page.evaluate(() => window.MacaChacha.write()); await page.clock.runFor(50);
    const before = await page.evaluate(() => window.MacaChacha.inspect());
    const contentBefore = await page.locator(".cm-content").boundingBox();
    await page.clock.runFor(5000);
    const expand = page.getByRole("button", { name: "茶々入れから会話を開く", exact: true });
    await expand.waitFor();
    assert.match(await expand.getAttribute("title"), /読者の声/);
    const after = await page.evaluate(() => window.MacaChacha.inspect());
    assert.equal(after.calls, 1); assert.equal(after.text, before.text); assert.deepEqual(after.selection, before.selection);
    assert.equal(after.focus, true); assert.equal(after.scroll, before.scroll); assert.equal(after.changes, before.changes);
    assert.equal((await page.locator(".cm-content").boundingBox()).width, contentBefore.width);
    assert.equal(await page.locator(".cm-chacha-tooltip").count(), 0);
    if (process.env.CHACHA_CAPTURE_DIR) await page.screenshot({ path: join(process.env.CHACHA_CAPTURE_DIR, `chacha-collapsed-${width}.png`) });
    const box = await expand.boundingBox(), content = await page.locator(".cm-content").boundingBox();
    assert.ok(box.width >= 24 && box.height >= 24); assert.ok(box.x >= content.x + content.width - 1);
    const requests = []; page.on("request", (request) => requests.push(request.url()));
    await expand.click(); await page.clock.runFor(50);
    const tooltip = page.locator(".ai-chat-quote"); await tooltip.waitFor();
    assert.equal(await page.locator(".cm-chacha-tooltip").count(), 0);
    assert.match(await tooltip.textContent(), /<img src=https:\/\/invalid.test>読者の声/);
    assert.equal(await tooltip.locator("img, a, script").count(), 0); assert.deepEqual(requests, []);
    const popover = await tooltip.boundingBox(); assert.ok(popover.x >= 0 && popover.x + popover.width <= width);
    if (process.env.CHACHA_CAPTURE_DIR) await page.screenshot({ path: join(process.env.CHACHA_CAPTURE_DIR, `chacha-expanded-${width}.png`) });
    await page.getByRole("button", { name: "AI チャットを閉じる", exact: true }).click(); await page.clock.runFor(50);
    assert.equal((await page.evaluate(() => window.MacaChacha.inspect())).text, before.text);
    assert.equal((await page.locator(".cm-content").boundingBox()).width, contentBefore.width);
  });
}
test("VimのInsert→NormalのEscはコメントを消さず、専用キーで会話を開ける", async (t) => {
  const page = await fixture(t, undefined, { vim: true });
  await page.evaluate(() => window.MacaChacha.write()); await page.clock.runFor(5050);
  await page.getByRole("button", { name: "茶々入れから会話を開く", exact: true }).waitFor();
  await page.locator(".cm-content").focus(); await page.keyboard.press("i"); await page.keyboard.press("Escape");
  assert.equal((await page.evaluate(() => window.MacaChacha.inspect())).phase, "collapsed");
  await page.keyboard.press("Control+Alt+Enter"); await page.clock.runFor(50);
  assert.equal((await page.evaluate(() => window.MacaChacha.inspect())).phase, "idle");
  await page.keyboard.press("Escape"); await page.clock.runFor(50);
  assert.equal((await page.evaluate(() => window.MacaChacha.inspect())).phase, "idle");
});
test("画面外へ移動したコメントを残さない", async (t) => {
  const page = await fixture(t); await page.evaluate(() => window.MacaChacha.write()); await page.clock.runFor(5050);
  await page.getByRole("button", { name: "茶々入れから会話を開く", exact: true }).waitFor();
  await page.evaluate(() => window.MacaChacha.scrollAway()); await page.clock.runFor(50);
  assert.equal((await page.evaluate(() => window.MacaChacha.inspect())).phase, "idle");
});
test("専用キーで開いた会話はEscで閉じて本文へ焦点を戻せる", async (t) => {
  const page = await fixture(t); await page.evaluate(() => window.MacaChacha.write()); await page.clock.runFor(5050);
  await page.getByRole("button", { name: "茶々入れから会話を開く", exact: true }).waitFor();
  await page.keyboard.press("Control+Alt+Enter"); await page.clock.runFor(50);
  assert.equal((await page.evaluate(() => window.MacaChacha.inspect())).phase, "idle");
  await page.keyboard.press("Escape"); await page.clock.runFor(50);
  assert.equal((await page.evaluate(() => window.MacaChacha.inspect())).phase, "idle");
  assert.equal((await page.evaluate(() => window.MacaChacha.inspect())).focus, true);
});
test("補完と検索のEscでコメントを同時に削除しない", async (t) => {
  const page = await fixture(t); await page.evaluate(() => window.MacaChacha.write()); await page.clock.runFor(5050);
  await page.getByRole("button", { name: "茶々入れから会話を開く", exact: true }).waitFor();
  await page.evaluate(() => window.MacaChacha.complete()); await page.clock.runFor(200);
  await page.getByRole("listbox").waitFor(); await page.keyboard.press("Escape"); await page.clock.runFor(50);
  assert.equal(await page.getByRole("listbox").count(), 0);
  assert.equal((await page.evaluate(() => window.MacaChacha.inspect())).phase, "collapsed");
  await page.keyboard.press("Control+f"); await page.clock.runFor(50);
  await page.locator(".cm-search").waitFor(); await page.keyboard.press("Escape"); await page.clock.runFor(50);
  assert.equal(await page.locator(".cm-search").count(), 0);
  assert.equal((await page.evaluate(() => window.MacaChacha.inspect())).phase, "collapsed");
  await page.keyboard.press("Escape"); await page.clock.runFor(50);
  assert.equal((await page.evaluate(() => window.MacaChacha.inspect())).phase, "idle");
});
