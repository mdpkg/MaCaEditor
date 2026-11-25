import { ChangeSet } from "@codemirror/state";
import { expect, test } from "vitest";
import { extractChachaContext } from "./chachaContext";
import { mapChachaContext } from "./chachaAnchor";

const source = "範囲外\n\n前\n\n対象\n\n後\n\n範囲外末尾";
test("送信範囲外の編集はアンカーと全送信範囲を追従させる", () => {
  const context = extractChachaContext(source, source.indexOf("対象"))!;
  const changes = ChangeSet.of({ from: 0, insert: "追加" }, source.length);
  const mapped = mapChachaContext(context, changes)!;
  expect(mapped.anchor.from).toBe(context.anchor.from + 2);
  expect(mapped.key).toBe(context.key);
  expect(mapped.ranges.map((r) => r.from)).toEqual(context.ranges.map((r) => r.from + 2));
});
test.each(["対象", "前", "後"])("送信済み %s の編集で即時失効する", (text) => {
  const context = extractChachaContext(source, source.indexOf("対象"))!;
  const from = source.indexOf(text);
  expect(mapChachaContext(context, ChangeSet.of({ from, to: from + text.length, insert: "別" }, source.length))).toBeNull();
});
test("境界の挿入は新しい構文を検証し、本文変更と前置段落の追加を区別する", () => {
  const context = extractChachaContext("対象", 0)!;
  const insertion = ChangeSet.of({ from: 0, insert: "文字" }, 2);
  expect(mapChachaContext(context, insertion, "文字対象")).toBeNull();
  // A preceding heading becomes transmitted context, so this is also invalid.
  expect(mapChachaContext(context, ChangeSet.of({ from: 0, insert: "# 章\n\n" }, 2), "# 章\n\n対象")).toBeNull();
});
