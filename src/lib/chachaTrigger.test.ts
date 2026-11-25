import { expect, test } from "vitest";
import { ChachaTrigger } from "./chachaTrigger";

const allowed = { enabled: true, paused: false, blocked: false, occupied: false };
test("初期状態・有効化だけ・移動だけでは送信しない", () => {
  const trigger = new ChachaTrigger("standard");
  expect(trigger.ready(1000000, allowed)).toBe(false);
  trigger.edit(100, 8, 0);
  expect(trigger.ready(5000, { ...allowed, enabled: false })).toBe(false);
  expect(trigger.ready(5000, allowed)).toBe(true);
  expect(trigger.position).toBe(8);
});
test.each([
  ["restrained", 250, 8000, 300000],
  ["standard", 100, 5000, 120000],
  ["frequent", 50, 3000, 60000],
] as const)("頻度 %s は最低編集量・停止時間・最低間隔を全て要求する", (frequency, count, idle, interval) => {
  const trigger = new ChachaTrigger(frequency);
  trigger.edit(count - 1, 1, 0);
  expect(trigger.ready(idle, allowed)).toBe(false);
  trigger.edit(1, 9, 10);
  expect(trigger.ready(10 + idle - 1, allowed)).toBe(false);
  expect(trigger.ready(10 + idle, allowed)).toBe(true);
  trigger.sent("file", "paragraph", idle + 10);
  trigger.edit(count, 10, idle + 20);
  expect(trigger.ready(idle + 10 + interval - 1, allowed)).toBe(false);
  expect(trigger.ready(idle + 10 + interval, allowed)).toBe(true);
});
test.each(["paused", "blocked", "occupied"] as const)("%s の間は送信できない", (gate) => {
  const trigger = new ChachaTrigger("standard"); trigger.edit(100, 1, 0);
  expect(trigger.ready(5000, { ...allowed, [gate]: true })).toBe(false);
});
test("停止・再開・ファイル切替時の編集リセットでは編集をまとめて送らない", () => {
  const trigger = new ChachaTrigger("standard"); trigger.edit(200, 1, 0);
  trigger.resetEdits();
  expect(trigger.ready(999999, allowed)).toBe(false);
  trigger.edit(1, 2, 999999);
  expect(trigger.ready(1004999, allowed)).toBe(false);
});
test("文書内のファイルを区別し、送信済み本文を再送しない", () => {
  const trigger = new ChachaTrigger("standard");
  trigger.sent("a.md", "same", 100);
  expect(trigger.seen("a.md", "same")).toBe(true);
  expect(trigger.seen("b.md", "same")).toBe(false);
  expect(trigger.seen("a.md", "different")).toBe(false);
  for (let i = 0; i < 129; i++) trigger.sent("a.md", String(i), 100 + i);
  expect(trigger.seen("a.md", "same")).toBe(false);
  expect(trigger.seen("a.md", "128")).toBe(true);
});
test("入力停止のタイマー待ち時間は最低間隔も尊重し、busy状態のポーリングを要求しない", () => {
  const trigger = new ChachaTrigger("standard");
  expect(trigger.delay(0)).toBeNull();
  trigger.edit(100, 2, 10);
  expect(trigger.delay(10)).toBe(5000);
  trigger.sent("a", "p", 5010);
  expect(trigger.delay(5010)).toBeNull();
  trigger.edit(100, 2, 5020);
  expect(trigger.delay(5020)).toBe(119990);
});
