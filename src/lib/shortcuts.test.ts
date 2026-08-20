import { describe, expect, it } from "vitest";
import { isSaveShortcut } from "./shortcuts";

describe("isSaveShortcut", () => {
  it("accepts Ctrl+S case-insensitively", () => {
    expect(isSaveShortcut({ key: "s", ctrlKey: true, metaKey: false, altKey: false })).toBe(true);
    expect(isSaveShortcut({ key: "S", ctrlKey: true, metaKey: false, altKey: false })).toBe(true);
  });

  it("accepts Cmd+S", () => {
    expect(isSaveShortcut({ key: "s", ctrlKey: false, metaKey: true, altKey: false })).toBe(true);
  });

  it("rejects modified or unrelated keys", () => {
    expect(isSaveShortcut({ key: "s", ctrlKey: false, metaKey: false, altKey: false })).toBe(false);
    expect(isSaveShortcut({ key: "s", ctrlKey: true, metaKey: false, altKey: true })).toBe(false);
    expect(isSaveShortcut({ key: "x", ctrlKey: true, metaKey: false, altKey: false })).toBe(false);
  });
});
