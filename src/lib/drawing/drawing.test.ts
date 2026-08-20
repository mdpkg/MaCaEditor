import { describe, expect, test } from "vitest";
import type { DrawingDocument } from "./model";
import {
  parseDrawingDocument,
  serializeDrawingDocument,
  validateDrawingDocument,
} from "./drawing";

const validJson = `{
  "format": "maca-drawing",
  "version": "1.0",
  "canvas": { "width": 1200, "height": 800, "gridSize": 10 },
  "objects": [
    {
      "id": "rect-1",
      "type": "rectangle",
      "x": 100,
      "y": 100,
      "width": 200,
      "height": 80,
      "rotation": 0,
      "zIndex": 1,
      "style": { "fill": "#ffffff", "stroke": "#000000", "strokeWidth": 1 },
      "text": "API"
    }
  ]
}`;

describe("drawing document parsing", () => {
  test("parses format", () => {
    const doc = parseDrawingDocument(validJson);
    expect(doc.format).toBe("maca-drawing");
  });

  test("parses version", () => {
    const doc = parseDrawingDocument(validJson);
    expect(doc.version).toBe("1.0");
  });

  test("parses canvas size", () => {
    const doc = parseDrawingDocument(validJson);
    expect(doc.canvas.width).toBe(1200);
    expect(doc.canvas.height).toBe(800);
  });

  test("parses objects array", () => {
    const doc = parseDrawingDocument(validJson);
    expect(doc.objects.length).toBe(1);
  });

  test("parses rectangle object", () => {
    const doc = parseDrawingDocument(validJson);
    const obj = doc.objects[0];
    expect(obj.type).toBe("rectangle");
    if (obj.type === "rectangle") {
      expect(obj.text).toBe("API");
    }
  });

  test("serializes document", () => {
    const doc = parseDrawingDocument(validJson);
    const json = serializeDrawingDocument(doc);
    const parsed = JSON.parse(json);
    expect(parsed.format).toBe("maca-drawing");
    expect(parsed.objects[0].id).toBe("rect-1");
  });

  test("round-trip preserves object", () => {
    const doc = parseDrawingDocument(validJson);
    const json = serializeDrawingDocument(doc);
    const parsed = parseDrawingDocument(json);
    expect(parsed.objects[0]).toEqual(doc.objects[0]);
  });

  test.each(["file", "user"] as const)("validates a %s shape", (type) => {
    const doc = parseDrawingDocument(validJson);
    doc.objects = [{
      id: `${type}-1`, type, x: 10, y: 20, width: 120, height: 80,
      rotation: 0, zIndex: 1, text: "", style: {},
    }];

    expect(() => validateDrawingDocument(doc)).not.toThrow();
  });

  test("rejects invalid json", () => {
    expect(() => parseDrawingDocument("not json")).toThrow();
  });

  test("rejects wrong format", () => {
    const bad = validJson.replace("maca-drawing", "other");
    expect(() => validateDrawingDocument(parseDrawingDocument(bad))).toThrow(
      "format",
    );
  });

  test("rejects missing version", () => {
    const bad = validJson.replace('"version": "1.0",', "");
    expect(() => validateDrawingDocument(parseDrawingDocument(bad))).toThrow(
      "version",
    );
  });

  test("rejects invalid canvas size", () => {
    const bad = validJson.replace('"width": 1200', '"width": -1');
    expect(() => validateDrawingDocument(parseDrawingDocument(bad))).toThrow(
      "canvas",
    );
  });

  test("rejects duplicate object ids", () => {
    const bad = validJson.replace(
      '"id": "rect-1"',
      '"id": "rect-1", "id2": "rect-1"',
    );
    // 2つ目のオブジェクトを追加して重複させる
    const withDup = bad.replace(
      '"objects": [',
      '"objects": [\n      { "id": "rect-1", "type": "rectangle", "x": 0, "y": 0, "width": 10, "height": 10, "rotation": 0, "zIndex": 2, "style": {} },',
    );
    expect(() => validateDrawingDocument(parseDrawingDocument(withDup))).toThrow(
      "id",
    );
  });

  test("accepts image object type", () => {
    const doc = parseDrawingDocument(validJson);
    const withImage: DrawingDocument = doc.objects[0]
      ? {
          ...doc,
          objects: [
            ...doc.objects,
            {
              id: "img-1",
              type: "image",
              x: 0,
              y: 0,
              width: 100,
              height: 80,
              rotation: 0,
              zIndex: 2,
              src: "data:image/png;base64,AAAA",
              style: {},
            },
          ],
        }
      : doc;
    expect(() => validateDrawingDocument(withImage)).not.toThrow();
  });

  test("rejects image with non-data src", () => {
    const doc = parseDrawingDocument(validJson);
    const withImage: DrawingDocument = {
      ...doc,
      objects: [
        ...doc.objects,
        {
          id: "img-1",
          type: "image",
          x: 0,
          y: 0,
          width: 100,
          height: 80,
          rotation: 0,
          zIndex: 2,
          src: "javascript:alert(1)",
          style: {},
        },
      ],
    };
    expect(() => validateDrawingDocument(withImage)).toThrow("src");
  });

  test("rejects image without src", () => {
    const doc = parseDrawingDocument(validJson);
    const withImage = {
      ...doc,
      objects: [
        ...doc.objects,
        {
          id: "img-1",
          type: "image",
          x: 0,
          y: 0,
          width: 100,
          height: 80,
          rotation: 0,
          zIndex: 2,
          style: {},
        },
      ],
    } as unknown as DrawingDocument;
    expect(() => validateDrawingDocument(withImage)).toThrow("src");
  });

  test("rejects image with whitespace-only src", () => {
    const doc = parseDrawingDocument(validJson);
    const withImage: DrawingDocument = {
      ...doc,
      objects: [
        ...doc.objects,
        {
          id: "img-1",
          type: "image",
          x: 0,
          y: 0,
          width: 100,
          height: 80,
          rotation: 0,
          zIndex: 2,
          src: "   ",
          style: {},
        },
      ],
    };
    expect(() => validateDrawingDocument(withImage)).toThrow("src");
  });

  test("rejects image with empty data url", () => {
    const doc = parseDrawingDocument(validJson);
    const withImage: DrawingDocument = {
      ...doc,
      objects: [
        ...doc.objects,
        {
          id: "img-1",
          type: "image",
          x: 0,
          y: 0,
          width: 100,
          height: 80,
          rotation: 0,
          zIndex: 2,
          src: "data:image/png;base64,",
          style: {},
        },
      ],
    };
    expect(() => validateDrawingDocument(withImage)).toThrow("src");
  });

  test("rejects image with bare data:image prefix", () => {
    const doc = parseDrawingDocument(validJson);
    const withImage: DrawingDocument = {
      ...doc,
      objects: [
        ...doc.objects,
        {
          id: "img-1",
          type: "image",
          x: 0,
          y: 0,
          width: 100,
          height: 80,
          rotation: 0,
          zIndex: 2,
          src: "data:image/",
          style: {},
        },
      ],
    };
    expect(() => validateDrawingDocument(withImage)).toThrow("src");
  });

  test("accepts group object type", () => {
    const doc = parseDrawingDocument(validJson);
    const withGroup: DrawingDocument = {
      ...doc,
      objects: [
        ...doc.objects,
        {
          id: "g-1",
          type: "group",
          x: 0,
          y: 0,
          width: 100,
          height: 50,
          rotation: 0,
          zIndex: 2,
          style: {},
          members: [
            {
              id: "r-2",
              type: "rectangle",
              x: 0,
              y: 0,
              width: 100,
              height: 50,
              rotation: 0,
              zIndex: 0,
              style: {},
            },
          ],
        },
      ],
    };
    expect(() => validateDrawingDocument(withGroup)).not.toThrow();
  });

  test("rejects unknown object type", () => {
    const bad = validJson.replace('"type": "rectangle"', '"type": "bogus"');
    expect(() => validateDrawingDocument(parseDrawingDocument(bad))).toThrow(
      "type",
    );
  });

  test("rejects connector referencing missing object", () => {
    const bad = validJson.replace(
      '"objects": [',
      '"objects": [\n      { "id": "conn-1", "type": "connector", "x": 0, "y": 0, "width": 0, "height": 0, "rotation": 0, "zIndex": 2, "style": {}, "from": { "objectId": "missing" }, "to": { "objectId": "rect-1" } },',
    );
    expect(() => validateDrawingDocument(parseDrawingDocument(bad))).toThrow(
      "connector",
    );
  });

  test("rejects non-finite numeric fields", () => {
    const bad = validJson.replace('"width": 200', '"width": "NaN"');
    expect(() => validateDrawingDocument(parseDrawingDocument(bad))).toThrow();
  });
});
