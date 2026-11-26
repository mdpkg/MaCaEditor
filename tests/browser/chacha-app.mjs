import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createServer } from "vite";
import { chromium } from "playwright";
import { join } from "node:path";

let server, browser;
before(async () => {
  server = await createServer({ server: { host: "127.0.0.1", port: 0, strictPort: false } });
  await server.listen(); browser = await chromium.launch();
});
after(async () => { await browser?.close(); await server?.close(); });
async function fixture(t, width = 1100, scale = 1) {
  const page = await browser.newPage({ viewport: { width, height: Math.round(900 / scale) }, deviceScaleFactor: scale });
  page.setDefaultTimeout(10000); page.setDefaultNavigationTimeout(120000);
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  t.after(async () => { await page.close(); assert.deepEqual(errors, []); });
  await page.addInitScript(() => {
    let nextCallback = 1;
    const callbacks = new Map();
    const state = window.__chachaTest = {
      requests: [], chatRequests: [], chatAttempts: [], chatPending: [], chatMode: "normal", cancellations: [], saves: [], preferences: {}, connection: { endpoint: "http://127.0.0.1:9/v1", model: "fixture-reader", revision: "one" },
      nextPath: "F:/fixture/a.mdpkg", savePath: "F:/fixture/saved.mdpkg",
      connectionUnavailable: false,
      mode: "normal", pending: [],
    };
    const source = "---\ntitle: PRIVATE-FRONTMATTER\n---\n\n# 茶々入れ検証\n\n前の段落\n\n対象\n\n後の段落\n\n```\nPRIVATE-CODE\n```\n\n遠い段落";
    const packageInfo = () => ({ manifest: { version: "2.0", entrypoint: "index.md" }, entrypoint: "index.md", files: [
      { path: "index.md", is_text: true, base64: null, content: source }, { path: "guide.md", is_text: true, base64: null, content: "別のMarkdown" }, { path: "notes.txt", is_text: true, base64: null, content: "plain file" },
    ] });
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      transformCallback(callback) { const id = nextCallback++; callbacks.set(id, callback); return id; },
      unregisterCallback(id) { callbacks.delete(id); }, convertFileSrc(path) { return path; },
      async invoke(command, args) {
        if (command === "plugin:event|listen") return nextCallback++;
        if (command === "plugin:dialog|open") return state.nextPath;
        if (command === "plugin:dialog|save") return state.savePath;
        if (command === "open_package") return packageInfo();
        if (command === "read_editor_preferences") return structuredClone(state.preferences);
        if (command === "save_editor_preferences") { Object.assign(state.preferences, structuredClone(args.preferences)); return; }
        if (command === "has_ai_configuration") return true;
        if (command === "chacha_connection") { if (state.connectionUnavailable) throw { kind: "connection" }; return structuredClone(state.connection); }
        if (command === "chat_connection") return { ...state.connection, endpoint: new URL(state.connection.endpoint).origin };
        if (command === "load_ai_config") return { provider: "OpenAiCompatible", base_url: state.connection.endpoint, model: state.connection.model, api_key: null, temperature: 0.7, max_output_tokens: 4096, connect_timeout_seconds: 10, request_timeout_seconds: 300 };
        if (command === "save_ai_config") { state.connection = { endpoint: args.config.base_url, model: args.config.model, revision: "changed" }; return; }
        if (command === "ai_document_chat") {
          let index = 0;
          const emit = (message) => callbacks.get(args.channel.id)?.({ index: index++, message });
          const record = { requestId: args.requestId, expectedConnection: args.expectedConnection, filename: args.filename,
            currentDocument: args.currentDocument, history: args.history, question: args.question, fields: Object.keys(args) };
          state.chatAttempts.push(structuredClone(record));
          try {
            if (args.expectedConnection !== state.connection.revision) throw { kind: "InvalidConfiguration", message: "chat_connection_changed" };
            state.chatRequests.push(structuredClone(record));
            emit({ type: "started", request_id: args.requestId });
            emit({ type: "delta", request_id: args.requestId, content: "途中の回答" });
            if (state.chatMode === "delayed") return await new Promise((resolve) => state.chatPending.push({
              id: args.requestId, finish(content) { resolve({ request_id: args.requestId, content }); },
            }));
            return { request_id: args.requestId, content: "会話の確定回答" };
          } finally { callbacks.get(args.channel.id)?.({ end: true, index }); }
        }
        if (command === "ai_chacha") {
          assertConnection(args);
          state.requests.push(structuredClone(args));
          if (state.mode === "offline") throw { kind: "transport" };
          if (state.mode === "delayed") return new Promise((resolve) => state.pending.push(resolve));
          return JSON.stringify({ type: "reaction", comment: args.request.messages[1].content.includes("辛口") ? "辛口の反応です。" : "読んでいるよ。" });
        }
        if (command === "cancel_ai_request") { state.cancellations.push(args.requestId); return false; }
        if (command === "save_package") { state.saves.push(structuredClone(args.request)); return {}; }
        return null;
      },
    };
    function assertConnection(args) { if (args.expectedConnection !== state.connection.revision) throw { kind: "connection" }; }
  });
  await page.goto(server.resolvedUrls.local[0]);
  await page.locator(".empty-state").getByRole("button", { name: "開く", exact: true }).click();
  await page.locator(".cm-content").waitFor();
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  return page;
}
const requests = (page) => page.evaluate(() => window.__chachaTest.requests);
async function write(page) {
  await page.locator(".cm-line").filter({ hasText: /^対象/ }).click();
  await page.keyboard.press("End"); await page.keyboard.insertText("書".repeat(100));
}
test("実Appは明示同意からだけ送信し、人格保存・停止再開・文書切替と保存データの分離を保つ", async (t) => {
  const page = await fixture(t);
  await write(page); await page.clock.fastForward(150000); assert.equal((await requests(page)).length, 0);
  await page.getByRole("button", { name: "茶々入れをこの文書で有効化", exact: true }).click();
  const consent = page.getByRole("dialog", { name: "この文書で茶々入れを有効化", exact: true }); await consent.waitFor();
  assert.match(await consent.textContent(), /2,000文字/); assert.match(await consent.textContent(), /120秒/); assert.match(await consent.textContent(), /料金/);
  assert.equal(await consent.getByRole("button", { name: "キャンセル", exact: true }).evaluate((button) => button === document.activeElement), true);
  await consent.getByRole("button", { name: "自動送信を有効にする", exact: true }).click();
  await page.clock.fastForward(120000); assert.equal((await requests(page)).length, 0);
  await write(page); await page.clock.runFor(5050);
  const expand = page.getByRole("button", { name: "茶々入れコメントを展開", exact: true }); await expand.waitFor();
  let sent = await requests(page); assert.equal(sent.length, 1); assert.equal(sent[0].expectedConnection, "one");
  const documentText = JSON.parse(sent[0].request.messages[2].content);
  assert.match(documentText.target, /^対象/); assert.equal(documentText.previous, "前の段落"); assert.equal(documentText.next, "後の段落");
  assert.ok(!JSON.stringify(sent).includes("PRIVATE")); assert.ok(!JSON.stringify(sent).includes("F:/fixture"));
  assert.equal(await page.locator(".cm-content").evaluate((element) => element === document.activeElement), true);
  await expand.click(); await page.clock.runFor(50); await page.locator(".cm-chacha-tooltip").getByText("読んでいるよ。", { exact: true }).waitFor();
  await page.getByRole("button", { name: "AI", exact: true }).click(); await page.getByRole("menuitem", { name: "AI 設定", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "AI 設定", exact: true });
  await settings.getByRole("textbox", { name: /読者の人格/ }).fill("辛口の読者"); assert.equal((await requests(page)).length, 1);
  await settings.getByRole("button", { name: "茶々入れ設定を保存", exact: true }).click();
  await settings.getByText("茶々入れ設定を保存しました。", { exact: true }).waitFor();
  await settings.getByRole("button", { name: "閉じる", exact: true }).click();
  await write(page); await page.clock.runFor(120000); sent = await requests(page);
  assert.equal(sent.length, 2); assert.match(sent[1].request.messages[1].content, /辛口の読者/);
  await page.getByRole("button", { name: "茶々入れを一時停止", exact: true }).click();
  await write(page); await page.clock.fastForward(180000); assert.equal((await requests(page)).length, 2);
  await page.getByRole("button", { name: "茶々入れを再開", exact: true }).click(); await page.clock.fastForward(120000);
  assert.equal((await requests(page)).length, 2);
  await page.locator(".cm-content").focus(); await page.keyboard.press("Control+s");
  await page.waitForFunction(() => window.__chachaTest.saves.length === 1);
  const saved = await page.evaluate(() => window.__chachaTest.saves[0]);
  assert.ok(!JSON.stringify(saved).includes("chacha")); assert.ok(!JSON.stringify(saved).includes("読んでいるよ"));
  await page.getByRole("button", { name: "AI", exact: true }).click(); await page.getByRole("menuitem", { name: "AI 設定", exact: true }).click();
  const connectionSettings = page.getByRole("dialog", { name: "AI 設定", exact: true });
  await connectionSettings.getByRole("textbox", { name: "ベース URL", exact: true }).fill("http://127.0.0.1:10/v1");
  await connectionSettings.getByRole("button", { name: "保存", exact: true }).click();
  await connectionSettings.getByText("保存しました。", { exact: true }).waitFor();
  assert.match(await connectionSettings.textContent(), /AI 接続設定が変わりました/);
  await connectionSettings.getByRole("button", { name: "閉じる", exact: true }).click();
  await write(page); await page.clock.fastForward(120000); assert.equal((await requests(page)).length, 2);
  await page.locator(".cm-content").focus(); await page.keyboard.press("Control+s"); await page.waitForFunction(() => window.__chachaTest.saves.length === 2);
  await page.getByRole("button", { name: "茶々入れをこの文書で有効化", exact: true }).click();
  const changedConsent = page.getByRole("dialog", { name: "この文書で茶々入れを有効化", exact: true });
  assert.match(await changedConsent.textContent(), /127\.0\.0\.1:10/);
  await changedConsent.getByRole("button", { name: "自動送信を有効にする", exact: true }).click();
  await page.clock.fastForward(120000); assert.equal((await requests(page)).length, 2);
  await page.locator('[data-path="guide.md"]').click();
  assert.equal(await page.getByRole("button", { name: "茶々入れを一時停止", exact: true }).count(), 1);
  await page.evaluate(() => { window.__chachaTest.nextPath = "F:/fixture/b.mdpkg"; });
  await page.getByRole("button", { name: "ファイル", exact: true }).click(); await page.getByRole("menuitem", { name: "開く", exact: true }).click();
  await page.getByRole("button", { name: "茶々入れをこの文書で有効化", exact: true }).waitFor();
  assert.equal((await requests(page)).length, 2);
});
test("狭い実Appでも同意ダイアログは画面内に収まりステータスバーの透明度を継承しない", async (t) => {
  const page = await fixture(t, 360);
  await page.getByRole("button", { name: "茶々入れをこの文書で有効化", exact: true }).click();
  const consent = page.getByRole("dialog", { name: "この文書で茶々入れを有効化", exact: true }); await consent.waitFor();
  const rect = await consent.boundingBox(); assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 360 && rect.y + rect.height <= 900);
  assert.equal(await consent.evaluate((element) => !!element.closest(".status-bar")), false);
  if (process.env.CHACHA_CAPTURE_DIR) await page.screenshot({ path: join(process.env.CHACHA_CAPTURE_DIR, "chacha-app-consent-360.png") });
  await consent.getByRole("button", { name: "キャンセル", exact: true }).click(); assert.equal((await requests(page)).length, 0);
});
test("接続未設定の案内が狭い画面の執筆領域を押しつぶさずAI設定へ進める", async (t) => {
  const page = await fixture(t, 360);
  await page.evaluate(() => { window.__chachaTest.connectionUnavailable = true; });
  await page.getByRole("button", { name: "茶々入れをこの文書で有効化", exact: true }).click();
  const setup = page.getByRole("button", { name: "AI 設定を開く", exact: true }); await setup.waitFor();
  const status = await page.locator(".status-bar").boundingBox(); assert.ok(status.height <= 64, JSON.stringify(status));
  const box = await setup.boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 360, JSON.stringify(box));
  await setup.click(); await page.getByRole("dialog", { name: "AI 設定", exact: true }).waitFor();
  assert.equal((await requests(page)).length, 0);
});

async function enable(page) {
  await page.getByRole("button", { name: "茶々入れをこの文書で有効化", exact: true }).click();
  await page.getByRole("button", { name: "自動送信を有効にする", exact: true }).click();
}
test("遅延中も編集を続けられ、キャンセルを無視した旧応答はファイル再訪後も表示しない", async (t) => {
  const page = await fixture(t); await enable(page);
  await page.evaluate(() => { window.__chachaTest.mode = "delayed"; });
  await write(page); await page.clock.runFor(5050);
  await page.waitForFunction(() => window.__chachaTest.requests.length === 1);
  await page.keyboard.insertText("遅延中も通常の入力を続ける。");
  await page.clock.runFor(65000);
  await page.locator('[data-path="guide.md"]').click();
  await page.locator('[data-path="index.md"]').dblclick();
  await page.evaluate(() => { window.__chachaTest.pending.splice(0).forEach((resolve) => resolve('{"type":"reaction","comment":"表示してはいけない旧応答"}')); });
  await page.clock.runFor(200000);
  assert.match(await page.locator(".cm-content").innerText(), /遅延中も通常の入力を続ける。/);
  assert.equal(await page.locator(".cm-chacha-buttons button").count(), 0);
  assert.equal((await requests(page)).length, 1);
  await page.keyboard.press("Control+s");
  await page.waitForFunction(() => window.__chachaTest.saves.length === 1);
  assert.doesNotMatch(await page.evaluate(() => JSON.stringify(window.__chachaTest.saves)), /表示してはいけない旧応答|chacha/i);
});
test("LLM停止時も編集・保存でき、3回失敗で静かに停止し自動再試行や編集の積み残しをしない", async (t) => {
  const page = await fixture(t); await enable(page);
  await page.evaluate(() => { window.__chachaTest.mode = "offline"; });
  for (let i = 0; i < 3; i++) {
    await write(page); await page.clock.runFor(i === 0 ? 5050 : 120050);
    await page.waitForFunction((count) => window.__chachaTest.requests.length === count, i + 1);
  }
  await page.getByRole("button", { name: "茶々入れを再開", exact: true }).waitFor();
  await write(page); await page.clock.fastForward(3600000);
  assert.equal((await requests(page)).length, 3);
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(await page.locator(".cm-chacha-buttons button").count(), 0);
  assert.ok((await page.locator(".cm-content").innerText()).includes("書".repeat(400)));
  await page.keyboard.press("Control+s"); await page.waitForFunction(() => window.__chachaTest.saves.length === 1);
  await page.getByRole("button", { name: "茶々入れを再開", exact: true }).click();
  await page.clock.fastForward(3600000); assert.equal((await requests(page)).length, 3);
});


test("チャットのタブ・対象ファイル・保存先・非Markdown選択が独立し保存内容へ混入しない", async (t) => {
  const page = await fixture(t);
  const toggle = page.getByRole("button", { name: "AI チャット", exact: true });
  await toggle.click();
  const panel = page.getByRole("complementary", { name: "AI チャット", exact: true });
  await panel.getByRole("tab", { name: "文書相談 1", exact: true }).waitFor();
  assert.equal(await panel.getByRole("textbox", { name: "AI チャットのメッセージ", exact: true }).evaluate((element) => element === document.activeElement), true);
  assert.equal(await page.evaluate(() => window.__chachaTest.chatRequests.length), 0);
  await page.locator('[data-path="guide.md"]').click();
  await panel.getByRole("textbox", { name: "AI チャットのメッセージ", exact: true }).fill("CHAT-ONLY-QUESTION-A");
  await panel.getByRole("button", { name: "送信", exact: true }).click();
  await panel.getByText("会話の確定回答", { exact: true }).waitFor();
  let sent = await page.evaluate(() => window.__chachaTest.chatRequests);
  assert.equal(sent[0].filename, "index.md"); assert.match(sent[0].currentDocument, /PRIVATE-FRONTMATTER/);
  assert.ok(!sent[0].fields.includes("apiKey"));
  await panel.getByRole("button", { name: "文書相談を追加", exact: true }).click();
  const input = panel.getByRole("textbox", { name: "AI チャットのメッセージ", exact: true });
  await input.fill("CHAT-ONLY-DRAFT-B");
  await panel.getByRole("tab", { name: "文書相談 1", exact: true }).click();
  assert.equal(await page.locator('[data-path="guide.md"]').getAttribute("aria-selected"), "true");
  await panel.getByRole("tab", { name: "文書相談 2", exact: true }).click();
  assert.equal(await input.inputValue(), "CHAT-ONLY-DRAFT-B");
  await panel.getByRole("button", { name: "AI チャットを閉じる", exact: true }).click(); await toggle.click();
  assert.equal(await input.inputValue(), "CHAT-ONLY-DRAFT-B");
  await page.keyboard.press("Control+Shift+s");
  await page.waitForFunction(() => window.__chachaTest.saves.length === 1);
  assert.equal(await panel.getByRole("tab").count(), 2);
  assert.equal(await input.inputValue(), "CHAT-ONLY-DRAFT-B");
  const saved = await page.evaluate(() => JSON.stringify(window.__chachaTest.saves));
  assert.ok(!saved.includes("CHAT-ONLY") && !saved.includes("会話の確定回答"));
  await page.locator('[data-path="notes.txt"]').click();
  assert.equal(await panel.getByRole("button", { name: "文書相談を追加", exact: true }).getAttribute("aria-disabled"), "true");
  await panel.getByRole("button", { name: "送信", exact: true }).click();
  await page.waitForFunction(() => window.__chachaTest.chatRequests.length === 2);
  sent = await page.evaluate(() => window.__chachaTest.chatRequests);
  assert.equal(sent[1].filename, "guide.md"); assert.equal(sent[1].currentDocument, "別のMarkdown");
  assert.deepEqual(sent[1].history, []);
});


test("チャットを閉じた生成中と停止終了待ちは自動茶々入れを抑制し過去の編集を再送しない", async (t) => {
  const page = await fixture(t, 360);
  await page.getByRole("button", { name: "ファイル一覧を開閉", exact: true }).click();
  await page.getByRole("button", { name: "茶々入れをこの文書で有効化", exact: true }).click();
  await page.getByRole("dialog", { name: "この文書で茶々入れを有効化", exact: true }).getByRole("button", { name: "自動送信を有効にする", exact: true }).click();
  await page.evaluate(() => { window.__chachaTest.chatMode = "delayed"; });
  await page.getByRole("button", { name: "AI チャット", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "AI チャット", exact: true });
  await panel.getByRole("textbox", { name: "AI チャットのメッセージ", exact: true }).fill("FIRST-QUESTION");
  await panel.getByRole("button", { name: "送信", exact: true }).click();
  await page.waitForFunction(() => window.__chachaTest.chatPending.length === 1);
  await panel.getByRole("button", { name: "文書相談を追加", exact: true }).click();
  const input = panel.getByRole("textbox", { name: "AI チャットのメッセージ", exact: true });
  await input.fill("SECOND-DRAFT"); assert.equal(await panel.getByRole("button", { name: "送信", exact: true }).isDisabled(), true);
  await panel.getByRole("button", { name: "AI チャットを閉じる", exact: true }).click();
  await page.locator(".ai-chat-status").waitFor();
  const indicator = await page.locator(".ai-chat-status").boundingBox();
  if (process.env.CHACHA_CAPTURE_DIR) await page.screenshot({ path: join(process.env.CHACHA_CAPTURE_DIR, "chat-360-busy.png") });
  assert.ok(indicator.x >= 0 && indicator.x + indicator.width <= 361);
  assert.equal(await page.locator(".ai-chat-status").evaluate((element) => element.scrollWidth <= element.clientWidth + 1), true);
  await write(page); await page.clock.fastForward(150000); assert.equal((await requests(page)).length, 0);
  await page.locator(".ai-chat-status").click();
  assert.equal(await input.inputValue(), "SECOND-DRAFT");
  await panel.getByRole("button", { name: "生成中の会話へ移動", exact: true }).click();
  await panel.getByRole("button", { name: "AI チャットを閉じる", exact: true }).click();
  await page.evaluate(() => window.__chachaTest.chatPending.shift().finish("FIRST-FULL-ANSWER"));
  await page.locator(".ai-chat-status").waitFor({ state: "hidden" });
  await page.clock.fastForward(150000); assert.equal((await requests(page)).length, 0);
  await page.getByRole("button", { name: "AI チャット", exact: true }).click();
  await panel.getByText("FIRST-FULL-ANSWER", { exact: true }).waitFor();
  await panel.getByRole("tab", { name: "文書相談 2", exact: true }).click(); assert.equal(await input.inputValue(), "SECOND-DRAFT");
  await panel.getByRole("button", { name: "送信", exact: true }).click();
  await page.waitForFunction(() => window.__chachaTest.chatPending.length === 1);
  await panel.getByRole("button", { name: "キャンセル", exact: true }).click();
  await panel.getByRole("button", { name: "AI チャットを閉じる", exact: true }).click();
  await write(page); await page.clock.fastForward(150000); assert.equal((await requests(page)).length, 0);
  await page.evaluate(() => window.__chachaTest.chatPending.shift().finish("IGNORED-LATE-ANSWER"));
  await page.locator(".ai-chat-status").waitFor({ state: "hidden" });
  await page.clock.fastForward(150000); assert.equal((await requests(page)).length, 0);
  await write(page); await page.clock.runFor(5050); await page.waitForFunction(() => window.__chachaTest.requests.length === 1);
  assert.equal(await page.getByRole("button", { name: "茶々入れを一時停止", exact: true }).count(), 1);
});


test("チャットの参照先は名前変更とUndo／Redoへ追従し削除復元では再接続しない", async (t) => {
  const page = await fixture(t);
  await page.locator('[data-path="guide.md"]').click();
  await page.getByRole("button", { name: "AI チャット", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "AI チャット", exact: true });
  await panel.getByRole("textbox", { name: "AI チャットのメッセージ", exact: true }).fill("retained draft");
  await page.locator('[data-path="guide.md"]').click({ button: "right" });
  await page.getByRole("menuitem", { name: "名前を変更", exact: true }).click();
  const rename = page.getByRole("dialog", { name: "guide.md の名前を変更", exact: true });
  await rename.getByRole("textbox").fill("renamed");
  await rename.getByRole("button", { name: "名前を変更", exact: true }).click();
  await panel.locator('[title="renamed.md"]').waitFor();
  await page.getByRole("button", { name: "ファイル", exact: true }).click();
  await page.getByRole("menuitem", { name: "元に戻す", exact: true }).click();
  await panel.locator('[title="guide.md"]').waitFor();
  await page.getByRole("button", { name: "ファイル", exact: true }).click();
  await page.getByRole("menuitem", { name: "やり直し", exact: true }).click();
  await panel.locator('[title="renamed.md"]').waitFor();
  await page.locator('[data-path="renamed.md"]').click({ button: "right" });
  await page.getByRole("menuitem", { name: "削除", exact: true }).click();
  await page.getByRole("dialog", { name: "renamed.md を削除しますか？", exact: true }).getByRole("button", { name: "削除", exact: true }).click();
  await panel.getByText(/この会話は読み取り専用/).waitFor();
  assert.equal(await panel.getByRole("textbox", { name: "AI チャットのメッセージ", exact: true }).inputValue(), "retained draft");
  assert.equal(await panel.getByRole("button", { name: "送信", exact: true }).isDisabled(), true);
  await page.getByRole("button", { name: "ファイル", exact: true }).click();
  await page.getByRole("menuitem", { name: "元に戻す", exact: true }).click();
  await page.locator('[data-path="renamed.md"]').waitFor();
  assert.equal(await panel.getByRole("button", { name: "送信", exact: true }).isDisabled(), true);
  assert.equal(await page.evaluate(() => window.__chachaTest.chatRequests.length), 0);
});
for (const [width, scale] of [[360, 1], [550, 2]]) for (const theme of ["light", "dark"]) {
  test(`チャットは${width}px・${scale}倍・${theme}で選択タブと入力を画面内に表示する`, async (t) => {
    const page = await fixture(t, width, scale); await page.emulateMedia({ colorScheme: theme });
    await page.getByRole("button", { name: "AI チャット", exact: true }).click();
    const panel = page.getByRole("complementary", { name: "AI チャット", exact: true });
    await panel.getByRole("tab").waitFor();
    for (let n = 0; n < 7; n++) await panel.getByRole("button", { name: "文書相談を追加", exact: true }).click();
    const rect = await panel.boundingBox(), list = await panel.getByRole("tablist").boundingBox();
    const selected = await panel.locator('[role="tab"][aria-selected="true"]').boundingBox();
    assert.ok(rect.x >= 0 && rect.x + rect.width <= width + 1);
    assert.ok(selected.x >= list.x - 1 && selected.x + selected.width <= list.x + list.width + 1);
    assert.equal(await panel.getByRole("textbox", { name: "AI チャットのメッセージ", exact: true }).evaluate((element) => element === document.activeElement), true);
    assert.equal(await page.evaluate(() => window.__chachaTest.chatRequests.length), 0);
    if (process.env.CHACHA_CAPTURE_DIR) await page.screenshot({ path: join(process.env.CHACHA_CAPTURE_DIR, `chat-${width}-${theme}-${scale}x.png`) });
  });
}



test("チャットは別文書の同じMarkdownパスへ旧履歴や遅延回答を混入しない", async (t) => {
  const page = await fixture(t);
  await page.getByRole("button", { name: "AI チャット", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "AI チャット", exact: true });
  const input = panel.getByRole("textbox", { name: "AI チャットのメッセージ", exact: true });
  await input.fill("OLD-DOCUMENT-QUESTION"); await panel.getByRole("button", { name: "送信", exact: true }).click();
  await panel.getByText("会話の確定回答", { exact: true }).waitFor();
  await page.evaluate(() => { window.__chachaTest.chatMode = "delayed"; });
  await input.fill("PENDING-OLD-DOCUMENT"); await panel.getByRole("button", { name: "送信", exact: true }).click();
  await page.waitForFunction(() => window.__chachaTest.chatPending.length === 1);
  await page.evaluate(() => { window.__chachaTest.nextPath = "F:/fixture/other.mdpkg"; });
  await page.getByRole("button", { name: "ファイル", exact: true }).click();
  await page.getByRole("menuitem", { name: "開く", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.ai-chat-panel .ai-chat-message').length === 0);
  await panel.getByRole("tab", { name: "文書相談 1", exact: true }).waitFor();
  assert.equal(await panel.getByRole("tab").count(), 1); assert.equal(await input.inputValue(), "");
  assert.equal(await panel.getByRole("button", { name: "送信", exact: true }).isDisabled(), true);
  await input.fill("NEW-DOCUMENT-DRAFT");
  await page.evaluate(() => { window.__chachaTest.chatPending.shift().finish("STALE-OLD-ANSWER"); window.__chachaTest.chatMode = "normal"; });
  await page.locator(".ai-chat-status").waitFor({ state: "hidden" });
  assert.equal(await input.inputValue(), "NEW-DOCUMENT-DRAFT");
  assert.ok(!(await panel.textContent()).includes("STALE-OLD-ANSWER"));
  await panel.getByRole("button", { name: "送信", exact: true }).click();
  await page.waitForFunction(() => window.__chachaTest.chatRequests.length === 3);
  assert.deepEqual(await page.evaluate(() => window.__chachaTest.chatRequests[2].history), []);
  assert.equal(await page.getByRole("dialog").count(), 0);
});
