import { ChangeSet, Text } from "@codemirror/state";
import { afterEach, expect, test, vi } from "vitest";
import { ChachaSession } from "./chachaSession";
import { normalizeChachaSettings } from "./chachaSettings";
import { ChachaEdits } from "./chachaEdits";
afterEach(() => vi.useRealTimers());
test("one character, debounce reset, none cooldown and latest candidate need no extra edit", async () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  let source = "対象", blocked = false;
  const transport = vi.fn(async (_request: Parameters<import("./chachaSession").ChachaTransport>[0]) => '{"type":"none"}');
  const session = new ChachaSession(normalizeChachaSettings(), transport);
  session.attach({ file: "a.md", source: () => source, blocked: () => blocked, visible: () => true }); session.enable();
  const edit = (text: string) => { const change = ChangeSet.of({ from: source.length, insert: text }, source.length); source += text; session.changed(change); session.edited({ amount: 1, position: source.length }); };
  edit("一"); await vi.advanceTimersByTimeAsync(4999); expect(transport).not.toHaveBeenCalled();
  edit("二"); await vi.advanceTimersByTimeAsync(4999); expect(transport).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); expect(transport).toHaveBeenCalledOnce();
  edit("三"); await vi.advanceTimersByTimeAsync(20000); edit("四");
  await vi.advanceTimersByTimeAsync(9999); expect(transport).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1); expect(transport).toHaveBeenCalledTimes(2);
  expect(JSON.parse(transport.mock.calls[1][0].messages[2].content).target).toBe("対象一二三四");
  blocked = true; session.pulse(); edit("五"); await vi.advanceTimersByTimeAsync(40000);
  blocked = false; session.pulse(); await vi.advanceTimersByTimeAsync(40000); expect(transport).toHaveBeenCalledTimes(2);
  edit("六"); await vi.advanceTimersByTimeAsync(5000); expect(transport).toHaveBeenCalledTimes(3);
  session.dispose(); expect(vi.getTimerCount()).toBe(0);
});
test("an identical replacement is not a text edit", () => {
  const before = Text.of(["same"]), change = ChangeSet.of({ from: 0, to: 4, insert: "same" }, 4);
  expect(new ChachaEdits().change(change, before, change.apply(before), false)).toBeNull();
});
test.each(["error", "cancel"])("%s retains request-start cooldown without automatic retry", async (outcome) => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  let source = "対象", attempt = 0;
  const transport = vi.fn(async (request: Parameters<import("./chachaSession").ChachaTransport>[0]) => {
    if (++attempt > 1) return '{"type":"none"}';
    if (outcome === "error") throw { kind: "transport" };
    return await new Promise<string>((_, reject) => request.signal.addEventListener("abort", () => reject({ kind: "cancelled" })));
  });
  const session = new ChachaSession(normalizeChachaSettings(), transport);
  session.attach({ file: "a.md", source: () => source, blocked: () => false, visible: () => true }); session.enable();
  session.edited({ amount: 1, position: 1 }); await vi.advanceTimersByTimeAsync(5000);
  if (outcome === "cancel") { session.pause(); await vi.advanceTimersByTimeAsync(0); session.resume(); }
  const changes = ChangeSet.of({ from: 2, insert: "新" }, source.length); source += "新"; session.changed(changes);
  session.edited({ amount: 1, position: source.length });
  await vi.advanceTimersByTimeAsync(29999); expect(transport).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1); expect(transport).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(300000); expect(transport).toHaveBeenCalledTimes(2);
  session.dispose();
});
