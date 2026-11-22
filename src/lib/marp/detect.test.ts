import { describe, expect, test } from "vitest";
import { detectMarp } from "./detect";

describe("Marp frontmatter", () => {
  test.each([
    ["---\nmarp: true\n---\n# Slide", true],
    ['---\nmarp: "true"\n---', false],
    ["---\nmarp: false\n---", false],
    ["---\ntitle: Slides\n---", false],
    ["---\nnested:\n  marp: true\n---", false],
    ["```yaml\n---\nmarp: true\n---\n```", false],
    ["# Slide\n---\nmarp: true", false],
    ["\uFEFF---\r\nmarp: true\r\n---\r\n# 日本語", true],
  ])("detects only a top-level boolean: %s", (source, expected) => {
    expect(detectMarp(source).marp).toBe(expected);
  });
  test.each([
    "---\nmarp: [\n---",
    "---\nmarp: true\nmarp: false\n---",
    "---\nmarp: true",
    `---\nmarp: true\ntext: ${"a".repeat(65_536)}\n---`,
    "---\nmarp: true\na: &a [1, 2]\nb: *a\n---",
  ])("warns and fails closed for invalid or excessive YAML", (source) => {
    expect(detectMarp(source)).toMatchObject({ marp: false, warning: expect.any(String) });
  });
  test("does not classify other text files", () => {
    expect(detectMarp("---\nmarp: true\n---", "file.txt").marp).toBe(false);
  });
});
