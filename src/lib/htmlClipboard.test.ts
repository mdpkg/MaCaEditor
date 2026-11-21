import { describe, expect, test } from "vitest";
import { htmlClipboardToMarkdown } from "./htmlClipboard";

describe("HTML clipboard conversion", () => {
  test("converts nested lists, numbering, and inline formatting", () => {
    expect(htmlClipboardToMarkdown('<ol start="3"><li><strong>First</strong><ul><li>A &amp; B</li></ul></li><li value="7">Last</li></ol>'))
      .toBe("3. **First**\n   - A & B\n7. Last");
  });

  test("keeps surrounding paragraphs and converts tables without losing cells", () => {
    expect(htmlClipboardToMarkdown('<p>Before</p><table><tr><th>Name</th><th>Value</th></tr><tr><td>A|B</td><td>one<br>two</td></tr></table><p>After</p>'))
      .toBe("Before\n\n| Name | Value |\n| --- | --- |\n| A\\|B | one<br>two |\n\nAfter");
  });

  test("uses the first row as headers and pads merged or missing cells", () => {
    expect(htmlClipboardToMarkdown('<table><tr><td rowspan="2">A</td><td colspan="2">B</td></tr><tr><td>C</td><td>D</td></tr></table>'))
      .toBe("| A | B |  |\n| --- | --- | --- |\n|  | C | D |");
  });

  test("escapes Markdown literals and preserves links and code", () => {
    expect(htmlClipboardToMarkdown('<ul><li>*literal* <a href="https://example.com">link</a> <code>x*y</code></li></ul>'))
      .toBe('- \\*literal\\* [link](<https://example.com>) ` x*y `');
  });

  test("ignores executable content and unsafe links", () => {
    expect(htmlClipboardToMarkdown('<script>alert(1)</script><ul><li><a href="javascript:alert(1)">safe text</a></li></ul>'))
      .toBe("- safe text");
  });

  test.each(["", "<p>Ordinary text</p>", "<style>ul {}</style>", "<table></table>"])(
    "falls back to plain text for %s", (html) => expect(htmlClipboardToMarkdown(html)).toBeNull(),
  );
});
