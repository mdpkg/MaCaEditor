import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";
import { chromium } from "playwright";

let server, browser;
before(async () => {
  server = await createServer({ server: { host: "127.0.0.1", port: 0 } });
  await server.listen();
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); await server?.close(); });

for (const viewport of [{ width: 1000, height: 900 }, { width: 360, height: 640 }]) {
  test(`茶々入れ設定は ${viewport.width}px 幅で保存・復元まで操作できる`, async () => {
    const page = await browser.newPage({ viewport });
    try {
      await page.goto(server.resolvedUrls.local[0]);
      await page.evaluate(async () => {
        const ReactModule = await import("/node_modules/.vite/deps/react.js");
        const React = ReactModule.default ?? ReactModule;
        const DomModule = await import("/node_modules/.vite/deps/react-dom_client.js");
        const { createRoot } = DomModule.default ?? DomModule;
        const { AiSettingsDialog } = await import("/src/components/AiSettingsDialog.tsx");
        const host = document.createElement("div"); document.body.append(host);
        createRoot(host).render(React.createElement(AiSettingsDialog, { onClose() {} }));
      });
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
