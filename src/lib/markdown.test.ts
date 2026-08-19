import { describe, expect, test } from "vitest";
import { resolvePackagePath } from "./markdown";

describe("resolvePackagePath", () => {
  test("resolves relative image path", () => {
    expect(resolvePackagePath("", "images/screenshot.png")).toBe(
      "images/screenshot.png",
    );
  });

  test("resolves relative path from subdirectory", () => {
    expect(resolvePackagePath("docs", "images/screenshot.png")).toBe(
      "docs/images/screenshot.png",
    );
  });

  test("rejects parent directory traversal", () => {
    expect(resolvePackagePath("", "../../secret.png")).toBeNull();
  });

  test("rejects absolute path", () => {
    expect(resolvePackagePath("", "/etc/passwd")).toBeNull();
  });

  test("accepts leading dot slash", () => {
    expect(resolvePackagePath("", "./images/a.png")).toBe("images/a.png");
  });

  test("normalizes backslash separators", () => {
    expect(resolvePackagePath("", "images\\a.png")).toBe("images/a.png");
  });
});
