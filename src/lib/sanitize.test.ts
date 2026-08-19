import { describe, expect, test } from "vitest";
import { sanitizeHtml } from "./sanitize";

describe("sanitizeHtml", () => {
  test("removes script tags", () => {
    const result = sanitizeHtml("<script>alert(1)</script><p>ok</p>");
    expect(result).not.toContain("script");
    expect(result).toContain("ok");
  });

  test("removes iframe tags", () => {
    const result = sanitizeHtml("<iframe src='x'></iframe>");
    expect(result).not.toContain("iframe");
  });

  test("removes event handler attributes", () => {
    const result = sanitizeHtml("<p onclick='alert(1)'>ok</p>");
    expect(result).not.toContain("onclick");
  });

  test("removes javascript urls", () => {
    const result = sanitizeHtml("<a href='javascript:alert(1)'>link</a>");
    expect(result).not.toContain("javascript:");
  });

  test("keeps safe content", () => {
    const result = sanitizeHtml("<p>hello <strong>world</strong></p>");
    expect(result).toContain("hello");
    expect(result).toContain("world");
  });
});
