import { expect, test } from "vitest";
import { slideAtOffset, mapSourceOffset } from "./position";

test("maps source positions to whole slides including the last exclusive bound", () => {
  const slides = [{ slideIndex: 0, startOffset: 0, endOffset: 20 }, { slideIndex: 1, startOffset: 20, endOffset: 50 }];
  expect([0, 19, 20, 49, 50, 100].map((offset) => slideAtOffset(slides, offset))).toEqual([0, 0, 1, 1, 1, 1]);
  expect(slideAtOffset([], 0)).toBe(0);
});

test("follows the old source when slides are inserted or deleted before it", () => {
  const before = "# A\n\n---\n# B\n\n---\n# C";
  const offset = before.indexOf("# B");
  const inserted = before.replace("# B", "# Added\n\n---\n# B");
  expect(mapSourceOffset(before, inserted, offset)).toBe(inserted.indexOf("# B"));
  expect(mapSourceOffset(before, before.slice(offset), offset)).toBe(0);
  expect(mapSourceOffset(before, "# A", offset)).toBe(3);
  expect(mapSourceOffset(before, before, offset)).toBe(offset);
});
