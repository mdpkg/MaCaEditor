import { expect, test } from "vitest";
import { resolvePreviewLink } from "./previewUrl";

test.each([
  "java\tscript:probe()", "java%09script:probe()", "java%0ascript:probe()", "java%0dscript:probe()",
  " javascript:probe()", "javascript:probe()", "JaVaScRiPt:probe()", "%6aavascript%3aprobe()",
  "java%2509script:probe()", "%256aavascript:probe()", "%00javascript:probe()",
  "data:text/html,x", "vbscript:x", "file:///x", "blob:http://127.0.0.1/x", "ftp://127.0.0.1/x",
  "//127.0.0.1/x", "\\\\127.0.0.1/x", "../../outside", "%2e%2e/%2e%2e/outside", "https://", "bad%xx",
  "https:relative", "x.md\n", "%20javascript:probe()", "x%7f.md",
])("rejects unsafe or ambiguous destination %s", (url) => {
  expect(resolvePreviewLink("docs", url)).toEqual({ href: "#", path: null });
});

test.each([
  ["../日本語%20file.md?q=1#part", "日本語 file.md", "%E6%97%A5%E6%9C%AC%E8%AA%9E%20file.md?q=1#part"],
  ["./images/a.png", "docs/images/a.png", "docs/images/a.png"],
  ["a%23b%3Fc.png", "docs/a#b?c.png", "docs/a%23b%3Fc.png"],
  ["100%25.md", "docs/100%.md", "docs/100%25.md"],
  ["#見出し", null, "#見出し"], ["?q=1#part", null, "?q=1#part"],
  ["https://127.0.0.1/a%20b?q=1#part", null, "https://127.0.0.1/a%20b?q=1#part"],
  ["http://127.0.0.1/", null, "http://127.0.0.1/"],
  ["mailto:a@example.invalid", null, "mailto:a@example.invalid"],
])("resolves safe destination %s once", (url, path, href) => {
  expect(resolvePreviewLink("docs", url!)).toEqual({ path, href });
});
