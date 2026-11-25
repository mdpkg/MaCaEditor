import { afterEach, expect, test, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { invoke } from "@tauri-apps/api/core";
import { requestChacha } from "./chachaTransport";
afterEach(() => vi.resetAllMocks());
test("保存済み接続を使う専用コマンドへ履歴なしの要求だけを渡す", async () => {
  vi.mocked(invoke).mockResolvedValueOnce('{"type":"none"}');
  const messages = [{ role: "System" as const, content: "fixed" }];
  await expect(requestChacha({ requestId: "id", messages, signal: new AbortController().signal, connectionRevision: "revision" })).resolves.toBe('{"type":"none"}');
  expect(invoke).toHaveBeenCalledWith("ai_chacha", { requestId: "id", expectedConnection: "revision", request: { messages, max_output_tokens: 256, temperature: null } });
});
test("開始前に停止した通信は送らず、実行中は同じIDでキャンセルを試みる", async () => {
  const aborted = new AbortController(); aborted.abort();
  await expect(requestChacha({ requestId: "before", messages: [], signal: aborted.signal, connectionRevision: "revision" })).rejects.toEqual({ kind: "cancelled" });
  expect(invoke).not.toHaveBeenCalled();
  let complete!: (value: string) => void;
  vi.mocked(invoke).mockImplementationOnce(() => new Promise<string>((resolve) => { complete = resolve; })).mockResolvedValueOnce(true);
  const abort = new AbortController();
  const pending = requestChacha({ requestId: "running", messages: [], signal: abort.signal, connectionRevision: "revision" });
  abort.abort();
  expect(invoke).toHaveBeenLastCalledWith("cancel_ai_request", { requestId: "running" });
  complete('{"type":"none"}'); await pending;
});
