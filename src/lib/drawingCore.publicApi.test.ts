import { describe, expect, test } from "vitest";
import {
  DRAWING_FORMAT,
  createObject,
  parseAndValidate,
  renderSvg,
  sanitizeImageSrc,
  type DrawingDocument,
} from "@maca/drawing-core";

describe("@maca/drawing-core public API", () => {
  test("creates, validates, and renders a drawing without MaCa Editor modules", () => {
    const document: DrawingDocument = {
      format: DRAWING_FORMAT,
      version: "1.0",
      canvas: { width: 640, height: 480, gridSize: 10 },
      objects: [],
    };

    document.objects.push(createObject(document, "rectangle", 10, 20));

    expect(parseAndValidate(JSON.stringify(document))).toEqual(document);
    expect(renderSvg(document)).toContain("<rect");
  });

  test("owns image source validation instead of depending on the editor sanitizer", () => {
    expect(sanitizeImageSrc("https://example.com/image.png")).toBe(
      "https://example.com/image.png",
    );
    expect(sanitizeImageSrc("javascript:alert(1)")).toBe("");
  });
});
