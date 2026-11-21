import { describe, expect, it, vi } from "vitest";
import { importedImageDataUrl, isSupportedImageName, readImageOrTextClipboard, toBase64 } from "./imageImport";
import { htmlClipboardToMarkdown } from "./htmlClipboard";

describe("clipboard format selection", () => {
  it("prefers a convertible HTML table over its image representation", async () => {
    const getType = vi.fn(async () => new Blob(["<table><tr><td>A</td></tr></table>"], { type: "text/html" }));
    const clipboard = {
      read: async () => [{ types: ["image/png", "text/html"], getType }],
      readText: vi.fn(async () => "A"),
    } as unknown as Clipboard;
    expect(await readImageOrTextClipboard(clipboard, { htmlToText: htmlClipboardToMarkdown }))
      .toBe("| A |\n| --- |");
    expect(getType.mock.calls).toEqual([["text/html"]]);
  });

  it.each([false, true])("falls back to plain text when HTML is unavailable (read fails: %s)", async (fails) => {
    const clipboard = {
      read: async () => {
        if (fails) throw new Error("Unavailable");
        return [{ types: ["text/html"], getType: async () => new Blob(["<p>Plain text</p>"]) }];
      },
      readText: async () => "Plain text",
    } as unknown as Clipboard;
    expect(await readImageOrTextClipboard(clipboard, { htmlToText: htmlClipboardToMarkdown })).toBe("Plain text");
  });
});

describe("dropped image import", () => {
  it.each(["a.png", "写真.JPG", "a.jpeg", "a.gif", "a.webp", "a.bmp"])(
    "accepts %s",
    (name) => expect(isSupportedImageName(name)).toBe(true),
  );

  it("rejects non-image files", () => {
    expect(isSupportedImageName("notes.txt")).toBe(false);
    expect(isSupportedImageName("fake.png.exe")).toBe(false);
  });

  it("encodes binary bytes as base64", () => {
    expect(toBase64(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe("iVBORw==");
  });

  it("builds an embeddable data URL from an imported image", () => {
    expect(importedImageDataUrl({ file_name: "写真.JPEG", base64: "AQID" })).toBe(
      "data:image/jpeg;base64,AQID",
    );
  });
});
