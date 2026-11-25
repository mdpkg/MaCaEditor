import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "vite";
import { chromium } from "playwright";
import react from "@vitejs/plugin-react";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

let bundle, browser;
before(async () => {
  const result = await build({ configFile: false, logLevel: "error", plugins: [react()], define: { "process.env.NODE_ENV": '"production"' },
    build: { write: false, lib: { entry: fileURLToPath(new URL("./chachaSettingsFixture.tsx", import.meta.url)), name: "MacaChachaSettings", formats: ["iife"] } } });
  bundle = (Array.isArray(result) ? result[0] : result).output.find((item) => item.type === "chunk").code;
  browser = await chromium.launch();
});
after(async () => browser?.close());

for (const viewport of [{ width: 1000, height: 900 }, { width: 360, height: 640 }]) {
  test(`茶々入れ設定は ${viewport.width}px 幅で保存・復元まで操作できる`, async () => {
    const page = await browser.newPage({ viewport });
    try {
      await page.setContent('<!doctype html><meta charset="utf-8"><div id="app"></div>');
      await page.addStyleTag({ content: await readFile(new URL("../../src/styles.css", import.meta.url), "utf8") });
      await page.addScriptTag({ content: bundle });
      await page.evaluate(() => window.MacaChachaSettings.mount());
      const save = page.getByRole("button", { name: "茶々入れ設定を保存", exact: true });
      await save.waitFor();
      const geometry = await page.getByRole("dialog").evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { top: rect.top, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight };
      });
      assert.ok(geometry.top >= 0 && geometry.bottom <= geometry.height, JSON.stringify(geometry));
      assert.ok(geometry.right <= geometry.width, JSON.stringify(geometry));
      const prompt = page.getByRole("textbox", { name: /読者の人格/ });
      await prompt.fill("辛口の読者");
      await page.getByRole("button", { name: "初期プロンプトに戻す", exact: true }).click();
      assert.match(await prompt.inputValue(), /隣で読んでいる親しい友人/);
      await save.click();
      await page.getByText("茶々入れ設定を保存しました。", { exact: true }).waitFor();
      await prompt.fill("あ".repeat(10001));
      assert.equal(await save.isDisabled(), true);
    } finally { await page.close(); }
  });
}
