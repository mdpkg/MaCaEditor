import { expect, test } from "vitest";
import { parseChachaResponse } from "./chachaResponse";

test.each(["reaction", "advice", "observation"])("正常な %s は検証済みプレーンテキストとして受理する", (type) => {
  expect(parseChachaResponse(JSON.stringify({ type, comment: "<script>読者の声</script>" }))).toEqual({ type, comment: "<script>読者の声</script>" });
});
test.each(["not json", "[]", "null", '{"type":"unknown","comment":"a"}', '{"type":"reaction"}', '{"type":"reaction","comment":" "}', '{"type":"reaction","comment":4}', '{"type":"reaction","comment":"a","url":"https://example.com"}', '{"type":"none"}'])("不正・反応なし %s は表示しない", (value) => {
  expect(parseChachaResponse(value)).toBeNull();
});
test("120 Unicode文字まで、raw応答は4096 bytesまでに制限する", () => {
  expect(parseChachaResponse(JSON.stringify({ type: "reaction", comment: "😀".repeat(120) }))?.comment).toBe("😀".repeat(120));
  expect(parseChachaResponse(JSON.stringify({ type: "reaction", comment: "あ".repeat(121) }))).toBeNull();
  expect(parseChachaResponse(" ".repeat(4096) + '{"type":"none"}')).toBeNull();
});
