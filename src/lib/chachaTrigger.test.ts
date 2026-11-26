import { expect, test } from "vitest";
import { ChachaTrigger } from "./chachaTrigger";

const allowed = { enabled: true, paused: false, blocked: false, occupied: false };
test("初期状態・有効化だけ・移動だけでは送信しない", () => {
  const trigger = new ChachaTrigger();
  expect(trigger.ready(1000000, allowed)).toBe(false);
  trigger.edit(100, 8, 0);
  expect(trigger.ready(5000, { ...allowed, enabled: false })).toBe(false);
  expect(trigger.ready(5000, allowed)).toBe(true);
  expect(trigger.position).toBe(8);
});
test("one-character edits use the common 5-second debounce and 30-second request-start cooldown", () => {
  const trigger = new ChachaTrigger(); trigger.edit(1, 1, 0);
  expect(trigger.delay(4999)).toBe(1); expect(trigger.delay(5000)).toBe(0);
  trigger.sent("file", "paragraph", 5000); trigger.edit(1, 10, 5010);
  expect(trigger.delay(34999)).toBe(1); expect(trigger.delay(35000)).toBe(0);
});
test.each(["paused", "blocked", "occupied"] as const)("%s の間は送信できない", (gate) => {
  const trigger = new ChachaTrigger(); trigger.edit(100, 1, 0);
  expect(trigger.ready(5000, { ...allowed, [gate]: true })).toBe(false);
});
test("停止・再開・ファイル切替時の編集リセットでは編集をまとめて送らない", () => {
  const trigger = new ChachaTrigger(); trigger.edit(200, 1, 0);
  trigger.resetEdits();
  expect(trigger.ready(999999, allowed)).toBe(false);
  trigger.edit(1, 2, 999999);
  expect(trigger.ready(1004999, allowed)).toBe(true);
});
test("文書内のファイルを区別し、送信済み本文を再送しない", () => {
  const trigger = new ChachaTrigger();
  trigger.sent("a.md", "same", 100);
  expect(trigger.seen("a.md", "same")).toBe(true);
  expect(trigger.seen("b.md", "same")).toBe(false);
  expect(trigger.seen("a.md", "different")).toBe(false);
  for (let i = 0; i < 129; i++) trigger.sent("a.md", String(i), 100 + i);
  expect(trigger.seen("a.md", "same")).toBe(false);
  expect(trigger.seen("a.md", "128")).toBe(true);
});
test("入力停止のタイマー待ち時間は最低間隔も尊重し、busy状態のポーリングを要求しない", () => {
  const trigger = new ChachaTrigger();
  expect(trigger.delay(0)).toBeNull();
  trigger.edit(100, 2, 10);
  expect(trigger.delay(10)).toBe(5000);
  trigger.sent("a", "p", 5010);
  expect(trigger.delay(5010)).toBeNull();
  trigger.edit(100, 2, 5020);
  expect(trigger.delay(5020)).toBe(29990);
});
