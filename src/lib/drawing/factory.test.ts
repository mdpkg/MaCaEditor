import { describe, expect, test } from "vitest";
import type { DrawingDocument } from "./model";
import { createImageObject, createObject } from "./factory";

function emptyDoc(): DrawingDocument {
  return {
    format: "maca-drawing",
    version: "1.0",
    canvas: { width: 1200, height: 800, gridSize: 10 },
    objects: [],
  };
}

describe("createObject", () => {
  test("creates rectangle", () => {
    const obj = createObject(emptyDoc(), "rectangle", 100, 100);
    expect(obj.type).toBe("rectangle");
    expect(obj.x).toBe(100);
    expect(obj.y).toBe(100);
  });

  test("creates ellipse", () => {
    const obj = createObject(emptyDoc(), "ellipse", 100, 100);
    expect(obj.type).toBe("ellipse");
  });

  test("creates text", () => {
    const obj = createObject(emptyDoc(), "text", 100, 100);
    expect(obj.type).toBe("text");
    if (obj.type === "text") {
      expect(obj.text).toBe("Text");
    }
  });

  test("creates line", () => {
    const obj = createObject(emptyDoc(), "line", 100, 100);
    expect(obj.type).toBe("line");
    if (obj.type === "line") {
      expect(obj.x2).toBe(200);
    }
  });

  test("creates arrow", () => {
    const obj = createObject(emptyDoc(), "arrow", 100, 100);
    expect(obj.type).toBe("arrow");
  });

  test("creates image", () => {
    const obj = createObject(emptyDoc(), "image", 100, 100);
    expect(obj.type).toBe("image");
    if (obj.type === "image") {
      expect(obj.width).toBe(160);
      expect(obj.height).toBe(120);
      expect(obj.src).toBe("");
      expect(obj.style).toEqual({});
    }
  });

  test("creates image with sanitized src", () => {
    const obj = createImageObject(emptyDoc(), 100, 100, "https://example.com/a.png");
    expect(obj.type).toBe("image");
    if (obj.type === "image") {
      expect(obj.src).toBe("https://example.com/a.png");
    }
  });

  test("sanitizes unsafe image src", () => {
    const obj = createImageObject(emptyDoc(), 100, 100, "javascript:alert(1)");
    expect(obj.type).toBe("image");
    if (obj.type === "image") {
      expect(obj.src).toBe("");
    }
  });

  test("creates connector", () => {
    const obj = createObject(emptyDoc(), "connector", 100, 100);
    expect(obj.type).toBe("connector");
  });

  test("assigns unique ids", () => {
    const doc = emptyDoc();
    const a = createObject(doc, "rectangle", 0, 0);
    const b = createObject(
      { ...doc, objects: [a] },
      "rectangle",
      0,
      0,
    );
    expect(a.id).not.toBe(b.id);
  });

  test("assigns increasing zIndex", () => {
    const doc = emptyDoc();
    const a = createObject(doc, "rectangle", 0, 0);
    const b = createObject({ ...doc, objects: [a] }, "rectangle", 0, 0);
    expect(b.zIndex).toBeGreaterThan(a.zIndex);
  });
});
