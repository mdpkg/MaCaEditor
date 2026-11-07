import { describe, expect, it } from "vitest";
import { isDocumentSearchShortcut, isPackageSearchShortcut, isSaveShortcut } from "./shortcuts";

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

describe("search shortcuts", () => {
  it.each([
    { ctrlKey: true, metaKey: false },
    { ctrlKey: false, metaKey: true },
  ])("separates the document and package searches for %o", (modifiers) => {
    const event = { key: "f", altKey: false, ...modifiers };
    expect(isDocumentSearchShortcut(event)).toBe(true);
    expect(isPackageSearchShortcut(event)).toBe(false);
    expect(isDocumentSearchShortcut({ ...event, key: "F", shiftKey: true })).toBe(false);
    expect(isPackageSearchShortcut({ ...event, key: "F", shiftKey: true })).toBe(true);
    expect(isPackageSearchShortcut({ ...event, altKey: true, shiftKey: true })).toBe(false);
  });
});
