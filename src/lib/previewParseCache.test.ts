import { describe, expect, test, vi } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Root } from "mdast";
import { PreviewParseCache, remarkReusePreviewParse } from "./previewParseCache";

const parser = unified().use(remarkParse).use(remarkGfm);
const tail = ("## Section\n\nAn ordinary paragraph.\n\n").repeat(1100);
const source = "本文の下書き\n\n| Label | Value |\n| --- | --- |\n| Start | [Guide](guide.md) |\n\n" + tail;

describe("preview parse reuse", () => {
  test.each([
    ["本文の下書き", "本文の下書きに追記"],
    ["Start", "Started"],
    ["Value", "Data"],
  ])("reuses a plain text edit and matches a full GFM parse for %s", (before, after) => {
    const cache = new PreviewParseCache();
    const initial = parser.parse(source) as Root;
    const rendered = cache.parse(source, () => initial);
    rendered.children.splice(0, 1);
    const revised = source.replace(before, after);
    const reparse = vi.fn(() => parser.parse(revised) as Root);
    expect(cache.parse(revised, reparse)).toEqual(parser.parse(revised));
    expect(reparse).not.toHaveBeenCalled();
    expect(cache.parse(source, () => { throw new Error("unchanged parse was discarded"); })).toEqual(initial);
  });

  test("reparses when editing can change Markdown syntax", () => {
    const cache = new PreviewParseCache();
    cache.parse(source, () => parser.parse(source) as Root);
    const revised = source.replace("Start", "**Start**");
    const reparse = vi.fn(() => parser.parse(revised) as Root);
    expect(cache.parse(revised, reparse)).toEqual(parser.parse(revised));
    expect(reparse).toHaveBeenCalledOnce();
  });

  test("wraps the remark parser without dropping its GFM table syntax", () => {
    const processor = unified().use(remarkParse).use(remarkGfm)
      .use(remarkReusePreviewParse, new PreviewParseCache());
    const revised = source.replace("Start", "Started");
    expect(processor.parse(source)).toEqual(parser.parse(source));
    expect(processor.parse(revised)).toEqual(parser.parse(revised));
  });
});
