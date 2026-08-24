import { describe, expect, test } from "vitest";
import {
  applyAiResult,
  discardSelection,
  insertBelow,
  isSelectionStale,
  replaceSelection,
} from "./aiApply";
import type { AiSelectionSnapshot } from "./aiSelection";

function snapshot(from: number, to: number, text: string): AiSelectionSnapshot {
  return { from, to, text };
}

describe("replaceSelection", () => {
  test("replaces the selected range with the AI result", () => {
    const result = replaceSelection("AAA BBB CCC", 4, 7, "XXX");
    expect(result.content).toBe("AAA XXX CCC");
  });
});

describe("insertBelow", () => {
  test("inserts the AI result right after the selection", () => {
    const result = insertBelow("AAA BBB CCC", 4, 7, "XXX");
    expect(result.content).toBe("AAA BBB XXX CCC");
  });
});

describe("discardSelection", () => {
  test("does not change the document", () => {
    const content = "AAA BBB CCC";
    expect(discardSelection(content)).toBe(content);
  });
});

describe("isSelectionStale", () => {
  test("returns false when the range still matches", () => {
    expect(isSelectionStale("AAA BBB CCC", 4, 7, "BBB")).toBe(false);
  });

  test("returns true when the document changed before the selection", () => {
    // AI 開始時: AAA BBB CCC (from=4, to=7)
    // 生成中に先頭へ ZZZ が追加された → BBB は 8..11 へ移動
    expect(isSelectionStale("ZZZ AAA BBB CCC", 8, 11, "BBB")).toBe(false);
    // 古い from/to のまま比較すると不一致
    expect(isSelectionStale("ZZZ AAA BBB CCC", 4, 7, "BBB")).toBe(true);
  });

  test("returns true when the selected text changed", () => {
    expect(isSelectionStale("AAA XXX CCC", 4, 7, "BBB")).toBe(true);
  });
});

describe("applyAiResult", () => {
  test("applies replace when not stale", () => {
    const result = applyAiResult("AAA BBB CCC", snapshot(4, 7, "BBB"), "XXX", "replace");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.result.content).toBe("AAA XXX CCC");
  });

  test("applies insert below when not stale", () => {
    const result = applyAiResult("AAA BBB CCC", snapshot(4, 7, "BBB"), "XXX", "insert");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.result.content).toBe("AAA BBB XXX CCC");
  });

  test("rejects stale selection without modifying the document", () => {
    const result = applyAiResult("ZZZ AAA BBB CCC", snapshot(4, 7, "BBB"), "XXX", "replace");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("stale");
  });
});
