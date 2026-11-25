import { StrictMode, act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { useChachaRuntime } from "./useChachaRuntime";
import * as preferences from "../lib/chachaPreferences";
import * as transport from "../lib/chachaTransport";
import { normalizeChachaSettings } from "../lib/chachaSettings";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.restoreAllMocks());
test("設定復元後も既定は無効で、文書切替・再オープン時は同意を引き継がない（StrictMode）", async () => {
  vi.spyOn(preferences, "loadChachaPreferences").mockResolvedValue({ prompt: "保存された人格", frequency: "frequent" });
  const request = vi.spyOn(transport, "requestChacha").mockResolvedValue('{"type":"none"}');
  let current!: ReturnType<typeof useChachaRuntime>;
  function Harness({ id }: { id: string | null }) { current = useChachaRuntime(id); return <span>{current.runtime?.session.snapshot.enabled ? "on" : "off"}</span>; }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<StrictMode><Harness id="a" /></StrictMode>));
    expect(current.settings.prompt).toBe("保存された人格"); expect(current.runtime?.session.snapshot.enabled).toBe(false);
    const old = current.runtime!; old.session.enable(); expect(old.session.snapshot.enabled).toBe(true);
    await act(async () => root.render(<StrictMode><Harness id="b" /></StrictMode>));
    expect(current.runtime?.session.snapshot.enabled).toBe(false); expect(current.runtime).not.toBe(old);
    old.session.enable(); expect(current.runtime?.session.snapshot.enabled).toBe(false);
    await act(async () => root.render(<StrictMode><Harness id="a" /></StrictMode>));
    expect(current.runtime?.session.snapshot.enabled).toBe(false); expect(request).not.toHaveBeenCalled();
    await act(async () => root.render(<StrictMode><Harness id={null} /></StrictMode>)); expect(current.runtime).toBeUndefined();
  } finally { act(() => root.unmount()); host.remove(); }
});
test("設定保存が遅い初期読込より新しい場合、保存した人格を優先する", async () => {
  let finish!: (value: ReturnType<typeof normalizeChachaSettings>) => void;
  vi.spyOn(preferences, "loadChachaPreferences").mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  let current!: ReturnType<typeof useChachaRuntime>;
  function Harness() { current = useChachaRuntime("a"); return null; }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<Harness />));
    expect(current.runtime).toBeUndefined();
    await act(async () => current.applySettings({ prompt: "新しい人格", frequency: "standard" }));
    await act(async () => finish({ prompt: "古い人格", frequency: "restrained" }));
    expect(current.settings.prompt).toBe("新しい人格"); expect(current.runtime).toBeDefined();
  } finally { act(() => root.unmount()); host.remove(); }
});
test("接続保存は旧応答を即時破棄し、接続変更時には再有効化を要求する", async () => {
  vi.spyOn(preferences, "loadChachaPreferences").mockResolvedValue(normalizeChachaSettings());
  const connection = { endpoint: "http://local/v1", model: "model", revision: "new" };
  vi.spyOn(transport, "loadChachaConnection").mockResolvedValue(connection);
  let current!: ReturnType<typeof useChachaRuntime>;
  function Harness() { current = useChachaRuntime("a"); return null; }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<Harness />));
    current.runtime!.connection.current = { ...connection, revision: "old" }; current.runtime!.session.enable();
    const dismiss = vi.spyOn(current.runtime!.session, "dismiss");
    await act(async () => { const pending = current.connectionSaved(); expect(dismiss).toHaveBeenCalledOnce(); await pending; });
    expect(current.runtime!.session.snapshot.enabled).toBe(false); expect(current.runtime!.session.snapshot.reason).toBe("connection");
  } finally { act(() => root.unmount()); host.remove(); }
});
