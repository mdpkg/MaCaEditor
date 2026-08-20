import { describe, expect, it } from "vitest";
import { importedImageDataUrl, isSupportedImageName, toBase64 } from "./imageImport";

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
