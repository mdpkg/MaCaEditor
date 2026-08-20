import { describe, expect, test } from "vitest";
import type { DrawingDocument, DrawingObject } from "./model";
import {
  alignObjects,
  bringForward,
  bringToFront,
  deleteObjects,
  moveObject,
  resizeObject,
  redo,
  sendBackward,
  sendToBack,
  undo,
  type History,
} from "./edit";

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

describe("moveObject", () => {
  test("moves object position", () => {
    const d = doc([rect("r1", 100, 100)]);
    const moved = moveObject(d, "r1", 20, 30);
    const obj = moved.objects.find((o) => o.id === "r1");
    expect(obj?.x).toBe(120);
    expect(obj?.y).toBe(130);
  });

  test("does not change other objects", () => {
    const d = doc([rect("r1", 100, 100), rect("r2", 300, 300)]);
    const moved = moveObject(d, "r1", 20, 30);
    const r2 = moved.objects.find((o) => o.id === "r2");
    expect(r2?.x).toBe(300);
  });
});

describe("resizeObject", () => {
  test("resizes object dimensions", () => {
    const d = doc([rect("r1", 100, 100)]);
    const resized = resizeObject(d, "r1", 200, 80);
    const obj = resized.objects.find((o) => o.id === "r1");
    expect(obj?.width).toBe(200);
    expect(obj?.height).toBe(80);
  });
});

describe("deleteObjects", () => {
  test("deletes selected objects", () => {
    const d = doc([rect("r1", 0, 0), rect("r2", 100, 100)]);
    const deleted = deleteObjects(d, ["r1"]);
    expect(deleted.objects.length).toBe(1);
    expect(deleted.objects[0].id).toBe("r2");
  });

  test("deletes connectors referencing deleted objects", () => {
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
    const deleted = deleteObjects(d, ["r1"]);
    expect(deleted.objects.some((o) => o.id === "c1")).toBe(false);
  });
});

describe("z-order", () => {
  test("bringToFront sets highest zIndex", () => {
    const d = doc([rect("r1", 0, 0), rect("r2", 100, 100)]);
    const out = bringToFront(d, ["r1"]);
    const r1 = out.objects.find((o) => o.id === "r1");
    const r2 = out.objects.find((o) => o.id === "r2");
    expect(r1!.zIndex).toBeGreaterThan(r2!.zIndex);
  });

  test("sendToBack sets lowest zIndex", () => {
    const d = doc([rect("r1", 0, 0), rect("r2", 100, 100)]);
    const out = sendToBack(d, ["r2"]);
    const r1 = out.objects.find((o) => o.id === "r1");
    const r2 = out.objects.find((o) => o.id === "r2");
    expect(r2!.zIndex).toBeLessThan(r1!.zIndex);
  });

  test("bringForward increases zIndex by one", () => {
    const d = doc([rect("r1", 0, 0), rect("r2", 100, 100)]);
    const out = bringForward(d, ["r1"]);
    const r1 = out.objects.find((o) => o.id === "r1");
    expect(r1!.zIndex).toBe(2);
  });

  test("sendBackward decreases zIndex by one", () => {
    const d = doc([rect("r1", 0, 0), rect("r2", 100, 100)]);
    const out = sendBackward(d, ["r2"]);
    const r2 = out.objects.find((o) => o.id === "r2");
    expect(r2!.zIndex).toBe(0);
  });
});

describe("alignObjects", () => {
  const d = doc([
    rect("r1", 0, 0),
    rect("r2", 100, 50),
    rect("r3", 200, 100),
  ]);

  test("align left", () => {
    const out = alignObjects(d, ["r1", "r2", "r3"], "left");
    for (const o of out.objects) {
      expect(o.x).toBe(0);
    }
  });

  test("align right", () => {
    const out = alignObjects(d, ["r1", "r2", "r3"], "right");
    for (const o of out.objects) {
      expect(o.x + o.width).toBe(300);
    }
  });

  test("align center", () => {
    const out = alignObjects(d, ["r1", "r2", "r3"], "center");
    for (const o of out.objects) {
      expect(o.x + o.width / 2).toBe(150);
    }
  });

  test("align top", () => {
    const out = alignObjects(d, ["r1", "r2", "r3"], "top");
    for (const o of out.objects) {
      expect(o.y).toBe(0);
    }
  });

  test("align bottom", () => {
    const out = alignObjects(d, ["r1", "r2", "r3"], "bottom");
    for (const o of out.objects) {
      expect(o.y + o.height).toBe(150);
    }
  });

  test("align middle", () => {
    const out = alignObjects(d, ["r1", "r2", "r3"], "middle");
    for (const o of out.objects) {
      expect(o.y + o.height / 2).toBe(75);
    }
  });
});

describe("history", () => {
  test("undo restores previous state", () => {
    const d = doc([rect("r1", 0, 0)]);
    const moved = moveObject(d, "r1", 50, 50);
    const history: History = [{ before: d, after: moved }];
    const { doc: undone } = undo(history);
    expect(undone.objects[0].x).toBe(0);
  });

  test("redo reapplies change", () => {
    const d = doc([rect("r1", 0, 0)]);
    const moved = moveObject(d, "r1", 50, 50);
    const history: History = [{ before: d, after: moved }];
    const { doc: undone } = undo(history);
    const { doc: redone } = redo(history);
    expect(redone.objects[0].x).toBe(50);
    expect(undone.objects[0].x).toBe(0);
  });
});
