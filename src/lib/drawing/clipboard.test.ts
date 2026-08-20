import { describe, expect, test } from "vitest";
import type { DrawingDocument, DrawingObject } from "./model";
import { copyObjects, pasteObjects } from "./clipboard";

function rect(id: string, x: number, y: number): DrawingObject {
  return {
    id,
    type: "rectangle",
    x,
    y,
    width: 100,
    height: 50,
    rotation: 0,
    zIndex: 1,
    style: {},
  };
}

function doc(objects: DrawingObject[]): DrawingDocument {
  return {
    format: "maca-drawing",
    version: "1.0",
    canvas: { width: 1200, height: 800, gridSize: 10 },
    objects,
  };
}

describe("clipboard", () => {
  test("copy stores selected objects", () => {
    const d = doc([rect("r1", 0, 0), rect("r2", 100, 100)]);
    const copied = copyObjects(d, ["r1"]);
    expect(copied.length).toBe(1);
    expect(copied[0].id).toBe("r1");
  });

  test("paste assigns new ids", () => {
    const d = doc([rect("r1", 0, 0)]);
    const copied = copyObjects(d, ["r1"]);
    const pasted = pasteObjects(d, copied);
    const newObj = pasted.objects.find((o) => o.id !== "r1");
    expect(newObj).toBeDefined();
    expect(newObj!.id).not.toBe("r1");
  });

  test("paste offsets position", () => {
    const d = doc([rect("r1", 0, 0)]);
    const copied = copyObjects(d, ["r1"]);
    const pasted = pasteObjects(d, copied);
    const newObj = pasted.objects.find((o) => o.id !== "r1");
    expect(newObj!.x).toBe(20);
    expect(newObj!.y).toBe(20);
  });

  test("paste remaps connector references", () => {
    const d = doc([
      rect("r1", 0, 0),
      rect("r2", 100, 100),
      {
        id: "c1",
        type: "connector",
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        rotation: 0,
        zIndex: 0,
        from: { objectId: "r1" },
        to: { objectId: "r2" },
        style: {},
      },
    ]);
    const copied = copyObjects(d, ["r1", "r2", "c1"]);
    const pasted = pasteObjects(d, copied);
    const newConn = pasted.objects.find((o) => o.type === "connector" && o.id !== "c1");
    expect(newConn).toBeDefined();
    const conn = newConn as typeof newConn & {
      from: { objectId: string };
      to: { objectId: string };
    };
    // 新しい参照は新しい ID を指す
    expect(conn!.from.objectId).not.toBe("r1");
    expect(conn!.to.objectId).not.toBe("r2");
    // 新しい参照先が存在する
    const ids = pasted.objects.map((o) => o.id);
    expect(ids).toContain(conn!.from.objectId);
    expect(ids).toContain(conn!.to.objectId);
  });
});
