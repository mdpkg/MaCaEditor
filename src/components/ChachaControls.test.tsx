import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { ChachaControls } from "./ChachaControls";
import { ChachaSession } from "../lib/chachaSession";
import { normalizeChachaSettings } from "../lib/chachaSettings";
import * as transport from "../lib/chachaTransport";
import type { ChachaRuntime } from "../hooks/useChachaRuntime";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.restoreAllMocks());
test("接続先・範囲・頻度・料金を確認して明示有効化し、停止・再開・無効化できる", async () => {
  vi.spyOn(transport, "loadChachaConnection").mockResolvedValue({ endpoint: "http://local/v1", model: "reader", revision: "one" });
  const request = vi.fn(async () => '{"type":"none"}');
  const settings = normalizeChachaSettings(), session = new ChachaSession(settings, request);
  const runtime: ChachaRuntime = { key: "a", session, connection: { current: undefined } };
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const click = async (label: string) => act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === label)!.click());
  try {
    await act(async () => root.render(<ChachaControls runtime={runtime} settings={settings} />));
    expect(session.snapshot.enabled).toBe(false); expect(transport.loadChachaConnection).not.toHaveBeenCalled();
    await click("この文書で有効化");
    const dialog = host.querySelector('[role="dialog"]')!;
    for (const text of ["http://local/v1", "reader", "2,000文字", "120秒", "100文字", "5秒", "料金"]) expect(dialog.textContent).toContain(text);
    expect(session.snapshot.enabled).toBe(false);
    await click("キャンセル"); expect(session.snapshot.enabled).toBe(false);
    await click("この文書で有効化"); await click("自動送信を有効にする");
    expect(runtime.connection.current?.revision).toBe("one"); expect(session.snapshot.enabled).toBe(true); expect(request).not.toHaveBeenCalled();
    await click("一時停止"); expect(session.snapshot.paused).toBe(true);
    await click("再開"); expect(session.snapshot.paused).toBe(false); expect(request).not.toHaveBeenCalled();
    await click("無効化"); expect(session.snapshot.enabled).toBe(false);
  } finally { act(() => root.unmount()); session.dispose(); host.remove(); }
});
test("同意画面を準備中に文書が変わったら古い有効化を破棄する", async () => {
  let finish!: (value: transport.ChachaConnection) => void;
  vi.spyOn(transport, "loadChachaConnection").mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const settings = normalizeChachaSettings();
  const a: ChachaRuntime = { key: "a", session: new ChachaSession(settings, vi.fn()), connection: { current: undefined } };
  const b: ChachaRuntime = { key: "b", session: new ChachaSession(settings, vi.fn()), connection: { current: undefined } };
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<ChachaControls runtime={a} settings={settings} />));
    await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
    await act(async () => root.render(<ChachaControls runtime={b} settings={settings} />));
    await act(async () => finish({ endpoint: "http://local/v1", model: "reader", revision: "old" }));
    expect(host.querySelector('[role="dialog"]')).toBeNull(); expect(b.session.snapshot.enabled).toBe(false);
  } finally { act(() => root.unmount()); a.session.dispose(); b.session.dispose(); host.remove(); }
});
