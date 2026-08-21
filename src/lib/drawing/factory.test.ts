import { describe, expect, test } from "vitest";
import type { DrawingDocument } from "./model";
import { createConnector, createCurvedConnector, createImageObject, createObject, createRectangleObject, createEllipseObject } from "./factory";

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

  test("createRectangleObject creates rectangle with default size and style", () => {
    const obj = createRectangleObject(emptyDoc(), 100, 100);
    expect(obj.type).toBe("rectangle");
    expect(obj.x).toBe(100);
    expect(obj.y).toBe(100);
    expect(obj.width).toBe(120);
    expect(obj.height).toBe(60);
    expect(obj.rotation).toBe(0);
    if (obj.type === "rectangle") {
      expect(obj.style).toEqual({ fill: "#ffffff", stroke: "#000000", strokeWidth: 1 });
      expect(obj.text).toBe("");
    }
  });

  test("creates ellipse", () => {
    const obj = createObject(emptyDoc(), "ellipse", 100, 100);
    expect(obj.type).toBe("ellipse");
  });

  test("creates a rounded rectangle", () => {
    const obj = createObject(emptyDoc(), "roundedRectangle", 100, 100);
    expect(obj).toMatchObject({
      type: "roundedRectangle",
      x: 100,
      y: 100,
      width: 120,
      height: 60,
      cornerRadius: 12,
    });
  });

  test.each(["file", "user"] as const)("creates a %s shape", (type) => {
    const obj = createObject(emptyDoc(), type, 100, 100);

    expect(obj).toMatchObject({
      type,
      x: 100,
      y: 100,
      width: 120,
      height: 80,
      text: "",
      style: { fill: "#ffffff", stroke: "#000000", strokeWidth: 1 },
    });
  });

  test("creates a registered auto shape", () => {
    const obj = createObject(emptyDoc(), "autoShape:flowDecision", 40, 50);
    expect(obj).toMatchObject({
      type: "autoShape",
      preset: "flowDecision",
      x: 40,
      y: 50,
      width: 120,
      height: 90,
      text: "",
    });
  });

  test("rejects an unknown auto shape", () => {
    expect(() => createObject(emptyDoc(), "autoShape:unknown", 0, 0))
      .toThrow("unknown auto shape preset");
  });

  test("createEllipseObject creates ellipse with default size and style", () => {
    const obj = createEllipseObject(emptyDoc(), 100, 100);
    expect(obj.type).toBe("ellipse");
    expect(obj.x).toBe(100);
    expect(obj.y).toBe(100);
    expect(obj.width).toBe(120);
    expect(obj.height).toBe(60);
    expect(obj.rotation).toBe(0);
    if (obj.type === "ellipse") {
      expect(obj.style).toEqual({ fill: "#ffffff", stroke: "#000000", strokeWidth: 1 });
      expect(obj.text).toBe("");
    }
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

  test("createCurvedConnector creates curved connector", () => {
    const obj = createCurvedConnector(emptyDoc(), "r1", "r2");
    expect(obj.type).toBe("connector");
    if (obj.type === "connector") {
      expect(obj.curve).toBe(true);
      expect(obj.from.objectId).toBe("r1");
      expect(obj.to.objectId).toBe("r2");
    }
  });

  test("creates a connector with a unique id between two shapes", () => {
    const base = emptyDoc();
    base.objects = [
      { id: "a", type: "rectangle", x: 0, y: 0, width: 100, height: 50, rotation: 0, zIndex: 1, style: {} },
      { id: "b", type: "rectangle", x: 200, y: 0, width: 100, height: 50, rotation: 0, zIndex: 2, style: {} },
      { id: "connector-1", type: "connector", x: 0, y: 0, width: 0, height: 0, rotation: 0, zIndex: 3, from: { objectId: "a" }, to: { objectId: "b" }, style: {} },
    ];
    expect(createConnector(base, "a", "b", false)).toMatchObject({
      id: "connector-2",
      from: { objectId: "a" },
      to: { objectId: "b" },
      curve: false,
    });
  });

  test("creates an elbow connector between two shapes", () => {
    const base = emptyDoc();
    base.objects = [
      { id: "a", type: "rectangle", x: 0, y: 0, width: 100, height: 50, rotation: 0, zIndex: 1, style: {} },
      { id: "b", type: "rectangle", x: 200, y: 0, width: 100, height: 50, rotation: 0, zIndex: 2, style: {} },
    ];
    expect(createConnector(base, "a", "b", false, true)).toMatchObject({
      type: "connector",
      from: { objectId: "a" },
      to: { objectId: "b" },
      curve: false,
      elbow: true,
    });
  });

  test("rejects connecting a shape to itself", () => {
    const base = emptyDoc();
    base.objects = [{ id: "a", type: "rectangle", x: 0, y: 0, width: 100, height: 50, rotation: 0, zIndex: 1, style: {} }];
    expect(() => createConnector(base, "a", "a", false)).toThrow("different shapes");
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
