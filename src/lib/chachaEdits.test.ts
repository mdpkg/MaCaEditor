import { ChangeSet, Text } from "@codemirror/state";
import { expect, test } from "vitest";
import { ChachaEdits } from "./chachaEdits";

const text = (value: string) => Text.of(value.split("\n"));
test("挿入と削除をUnicode文字数で一度ずつ数え、編集位置を保持する", () => {
  const counter = new ChachaEdits();
  const before = text("前😀後");
  const changes = ChangeSet.of({ from: 1, to: 3, insert: "か\u3099" }, before.length);
  expect(counter.change(changes, before, changes.apply(before), false)).toEqual({ amount: 3, position: 3 });
});
test("IME未確定テキストは数えず、確定時の実差分だけを集計する", () => {
  const counter = new ChachaEdits();
  const before = text("前後");
  const first = ChangeSet.of({ from: 1, insert: "にほん" }, before.length);
  const middle = first.apply(before);
  expect(counter.change(first, before, middle, true)).toBeNull();
  const last = ChangeSet.of({ from: 1, to: 4, insert: "日本" }, middle.length);
  const after = last.apply(middle);
  expect(counter.change(last, middle, after, true)).toBeNull();
  expect(counter.finish(after)).toEqual({ amount: 2, position: 3 });
  expect(counter.finish(after)).toBeNull();
});
test("IMEキャンセルと同一内容では編集量を増やさない", () => {
  const counter = new ChachaEdits(), before = text("本文");
  const changes = ChangeSet.of({ from: 2, insert: "仮" }, before.length);
  counter.change(changes, before, changes.apply(before), true);
  expect(counter.finish(before)).toBeNull();
  expect(counter.change(ChangeSet.empty(before.length), before, before, false)).toBeNull();
});
test("外部同期・ファイル切替によって未確定の集計を破棄できる", () => {
  const counter = new ChachaEdits(), before = text("文");
  const changes = ChangeSet.of({ from: 1, insert: "入力" }, before.length);
  counter.change(changes, before, changes.apply(before), true);
  counter.reset();
  expect(counter.finish(text("別ファイル"))).toBeNull();
});
