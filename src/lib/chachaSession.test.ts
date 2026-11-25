import { ChangeSet } from "@codemirror/state";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ChachaSession, type ChachaTransport } from "./chachaSession";
import { normalizeChachaSettings } from "./chachaSettings";

const sessions: ChachaSession[] = [];
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => { sessions.splice(0).forEach((s) => s.dispose()); vi.useRealTimers(); });
const reply = '{"type":"reaction","comment":"読んでいるよ"}';
function setup(transport: ChachaTransport = vi.fn(async () => reply)) {
  let source = "外\n\n前\n\n対象\n\n後\n\n外末尾", blocked = false, visible = true;
  const session = new ChachaSession(normalizeChachaSettings(), transport); sessions.push(session);
  const attach = (file = "a.md") => session.attach({ file, source: () => source, blocked: () => blocked, visible: () => visible });
  attach();
  const edit = () => session.edited({ amount: 100, position: source.indexOf("対象") });
  return { session, transport, attach, edit, target: () => source.indexOf("対象"), block: (v: boolean) => { blocked = v; session.pulse(); }, hide: () => { visible = false; session.pulse(); },
    change(from: number, to: number, insert: string) {
      const changes = ChangeSet.of({ from, to, insert }, source.length);
      source = source.slice(0, from) + insert + source.slice(to); session.changed(changes); session.pulse();
    } };
}
test("初期状態と有効化だけでは送らず、編集とidle後だけ1件送信する", async () => {
  const h = setup(); h.edit(); await vi.advanceTimersByTimeAsync(10000); expect(h.transport).not.toHaveBeenCalled();
  h.session.enable(); await vi.advanceTimersByTimeAsync(10000); expect(h.transport).not.toHaveBeenCalled();
  h.edit(); await vi.advanceTimersByTimeAsync(4999); expect(h.transport).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); expect(h.transport).toHaveBeenCalledOnce(); expect(h.session.snapshot.phase).toBe("collapsed");
  expect(h.session.snapshot.comment?.comment).toBe("読んでいるよ");
  h.edit(); await vi.advanceTimersByTimeAsync(120000); expect(h.transport).toHaveBeenCalledOnce();
});
test("保留は30秒、未展開は表示から180秒で破棄し、展開中は時間だけで消さない", async () => {
  let resolve!: (value: string) => void;
  const h = setup(vi.fn(() => new Promise<string>((r) => { resolve = r; })));
  h.session.enable(); h.edit(); await vi.advanceTimersByTimeAsync(5000); h.block(true); resolve(reply);
  await vi.advanceTimersByTimeAsync(0); expect(h.session.snapshot.phase).toBe("pending");
  await vi.advanceTimersByTimeAsync(30000); expect(h.session.snapshot.phase).toBe("idle");
  h.block(false); h.change(h.target() + 2, h.target() + 2, "2"); h.edit(); await vi.advanceTimersByTimeAsync(120000); resolve(reply);
  await vi.advanceTimersByTimeAsync(0); expect(h.session.snapshot.phase).toBe("collapsed");
  h.session.expand(); await vi.advanceTimersByTimeAsync(999999); expect(h.session.snapshot.phase).toBe("expanded");
  h.session.dismiss(); expect(h.session.snapshot.phase).toBe("idle");
});
test("未展開の寿命・画面外への移動ではコメントを破棄する", async () => {
  const h = setup(); h.session.enable(); h.edit(); await vi.advanceTimersByTimeAsync(5000);
  await vi.advanceTimersByTimeAsync(180000); expect(h.session.snapshot.phase).toBe("idle");
  h.edit(); await vi.advanceTimersByTimeAsync(5000); expect(h.transport).toHaveBeenCalledOnce(); // duplicate
  h.change(h.target() + 2, h.target() + 2, "2"); h.edit(); await vi.advanceTimersByTimeAsync(120000);
  expect(h.session.snapshot.phase).toBe("collapsed");
  h.hide(); expect(h.session.snapshot.phase).toBe("idle");
});
test("送信中は多重送信せず、停止時はキャンセル失敗後の応答も破棄する", async () => {
  let resolve!: (value: string) => void; let signal!: AbortSignal;
  const h = setup(vi.fn((request) => { signal = request.signal; return new Promise<string>((r) => { resolve = r; }); }));
  h.session.enable(); h.edit(); await vi.advanceTimersByTimeAsync(5000);
  h.edit(); h.session.pause(); expect(signal.aborted).toBe(true); resolve(reply);
  await vi.advanceTimersByTimeAsync(0); expect(h.session.snapshot.phase).toBe("idle");
  h.session.resume(); await vi.advanceTimersByTimeAsync(999999); expect(h.transport).toHaveBeenCalledOnce();
});
test.each(["pause", "disable", "connectionChanged", "dispose"] as const)("%s はタイマー・コメント・遅延応答を無効化する", async (operation) => {
  let resolve!: (value: string) => void;
  const h = setup(vi.fn(() => new Promise<string>((r) => { resolve = r; })));
  h.session.enable(); h.edit(); await vi.advanceTimersByTimeAsync(5000); h.session[operation](); resolve(reply);
  await vi.advanceTimersByTimeAsync(0); expect(h.session.snapshot.comment).toBeUndefined(); expect(vi.getTimerCount()).toBe(0);
});
test("送信文脈の編集は失効し、範囲外の編集ではアンカーが移動する", async () => {
  let resolve!: (value: string) => void;
  const h = setup(vi.fn(() => new Promise<string>((r) => { resolve = r; })));
  h.session.enable(); h.edit(); await vi.advanceTimersByTimeAsync(5000);
  h.change(0, 0, "追加"); resolve(reply); await vi.advanceTimersByTimeAsync(5000);
  expect(h.session.snapshot.phase).toBe("collapsed");
  expect(h.session.snapshot.comment?.context.anchor.from).toBe(8);
  h.change(8, 10, "変更"); expect(h.session.snapshot.phase).toBe("idle");
});
test("ファイル切替・設定変更では古い応答が混入せず、変更直後に送信しない", async () => {
  let resolve!: (value: string) => void;
  const h = setup(vi.fn(() => new Promise<string>((r) => { resolve = r; })));
  h.session.enable(); h.edit(); await vi.advanceTimersByTimeAsync(5000); h.attach("b.md"); resolve(reply);
  await vi.advanceTimersByTimeAsync(0); expect(h.session.snapshot.phase).toBe("idle");
  h.session.configure({ prompt: "新しい読者", frequency: "frequent" });
  await vi.advanceTimersByTimeAsync(120000); expect(h.transport).toHaveBeenCalledOnce();
});
test("60秒タイムアウトで破棄し、自動リトライしない", async () => {
  const h = setup(vi.fn(() => new Promise<string>(() => {})));
  h.session.enable(); h.edit(); await vi.advanceTimersByTimeAsync(65000); expect(h.session.snapshot.phase).toBe("idle");
  await vi.advanceTimersByTimeAsync(999999); expect(h.transport).toHaveBeenCalledOnce();
});
test.each(["auth", "rate"])("%s では停止理由を持って一時停止する", async (kind) => {
  const h = setup(vi.fn(async () => { throw { kind, retry_after: "120" }; }));
  h.session.enable(); h.edit(); await vi.advanceTimersByTimeAsync(5000);
  expect(h.session.snapshot.paused).toBe(true); expect(h.session.snapshot.reason).toBe(kind);
  if (kind === "rate") { expect(h.session.resume()).toBe(false); await vi.advanceTimersByTimeAsync(120000); }
  expect(h.session.resume()).toBe(true); expect(h.session.snapshot.paused).toBe(false);
});
test("連続3回の失敗で停止し、通常の失敗では通知や自動リトライを行わない", async () => {
  const h = setup(vi.fn(async () => { throw { kind: "transport" }; })); h.session.enable();
  for (let i = 0; i < 3; i++) { h.change(h.target(), h.target(), String(i)); h.edit(); await vi.advanceTimersByTimeAsync(i ? 120000 : 5000); }
  expect(h.transport).toHaveBeenCalledTimes(3); expect(h.session.snapshot.reason).toBe("failures");
});
test("開始条件成立と実通信の間に停止した場合は通信を開始しない", async () => {
  const h = setup(); h.session.enable(); h.edit();
  vi.advanceTimersByTime(5000); h.session.pause();
  await vi.advanceTimersByTimeAsync(0);
  expect(h.transport).not.toHaveBeenCalled();
});
test("無効化して再有効化してもRetry-Afterの待機を迂回しない", async () => {
  const h = setup(vi.fn(async () => { throw { kind: "rate", retry_after: "120" }; }));
  h.session.enable(); h.edit(); await vi.advanceTimersByTimeAsync(5000);
  h.session.disable(); h.session.enable(); h.change(h.target(), h.target(), "新"); h.edit();
  await vi.advanceTimersByTimeAsync(6000);
  expect(h.session.snapshot.paused).toBe(true); expect(h.transport).toHaveBeenCalledOnce();
});
test("キャンセル処理が完了するまでは別リクエストを並列実行しない", async () => {
  const completions: Array<(value: string) => void> = [];
  const h = setup(vi.fn(() => new Promise<string>((resolve) => completions.push(resolve))));
  h.session.enable(); h.edit(); await vi.advanceTimersByTimeAsync(5000);
  h.session.pause(); h.session.resume(); h.change(h.target(), h.target(), "新"); h.edit();
  await vi.advanceTimersByTimeAsync(120000);
  expect(h.transport).toHaveBeenCalledOnce();
  completions[0](reply); await vi.advanceTimersByTimeAsync(0);
  expect(h.transport).toHaveBeenCalledTimes(2); expect(h.session.snapshot.phase).toBe("requesting");
  completions[1](reply); await vi.advanceTimersByTimeAsync(0); expect(h.session.snapshot.phase).toBe("collapsed");
});
test("タイムアウトした旧応答が新しいコメントを置き換えない", async () => {
  const completions: Array<(value: string) => void> = [];
  const h = setup(vi.fn(() => new Promise<string>((resolve) => completions.push(resolve))));
  h.session.enable(); h.edit(); await vi.advanceTimersByTimeAsync(65000);
  h.change(h.target(), h.target(), "新"); h.edit(); await vi.advanceTimersByTimeAsync(60000);
  expect(completions).toHaveLength(2);
  completions[1]('{"type":"advice","comment":"新しい応答"}'); await vi.advanceTimersByTimeAsync(0);
  completions[0](reply); await vi.advanceTimersByTimeAsync(0);
  expect(h.session.snapshot.comment?.comment).toBe("新しい応答");
});
test("送信中の人格変更で旧応答を破棄し、同じファイルの再オープンでも復活しない", async () => {
  let resolve!: (value: string) => void;
  const h = setup(vi.fn(() => new Promise<string>((done) => { resolve = done; })));
  h.session.enable(); h.edit(); await vi.advanceTimersByTimeAsync(5000);
  h.session.configure({ prompt: "別の人格", frequency: "standard" }); h.attach("a.md"); resolve(reply);
  await vi.advanceTimersByTimeAsync(120000);
  expect(h.session.snapshot.comment).toBeUndefined(); expect(h.transport).toHaveBeenCalledOnce();
});
test("バックエンドの接続変更検出では自動送信を無効化し、再有効化を要求する", async () => {
  const h = setup(vi.fn(async () => { throw { kind: "connection" }; }));
  h.session.enable(); h.edit(); await vi.advanceTimersByTimeAsync(5000);
  expect(h.session.snapshot.enabled).toBe(false); expect(h.session.snapshot.reason).toBe("connection");
  expect(h.session.resume()).toBe(false);
});
test("randomUUIDを提供しないWebViewでも安全なUUIDで通信できる", async () => {
  const getRandomValues = crypto.getRandomValues.bind(crypto);
  vi.stubGlobal("crypto", { getRandomValues });
  try {
    const h = setup(); h.session.enable(); h.edit(); await vi.advanceTimersByTimeAsync(5000);
    expect(h.transport).toHaveBeenCalledOnce();
    expect(vi.mocked(h.transport).mock.calls[0][0].requestId).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
  } finally { vi.unstubAllGlobals(); }
});
