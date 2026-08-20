import { describe, expect, test } from "vitest";
import type { DrawingDocument, DrawingObject } from "./model";
import {
  alignObjects,
  bringForward,
  bringToFront,
  deleteObjects,
  groupObjects,
  insertImageObject,
  moveObject,
  moveObjectFromDragStart,
  moveObjectFromDragStartSnapped,
  resizeObject,
  redo,
  selectGroup,
  selectObject,
  sendBackward,
  sendToBack,
  ungroupObjects,
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

  test("calculates every drag frame from the original position", () => {
    const original = doc([rect("r1", 100, 100)]);
    const firstFrame = moveObjectFromDragStart(original, "r1", { x: 10, y: 10 }, { x: 20, y: 15 });
    const secondFrame = moveObjectFromDragStart(original, "r1", { x: 10, y: 10 }, { x: 30, y: 20 });
    expect(firstFrame.objects[0]).toMatchObject({ x: 110, y: 105 });
    expect(secondFrame.objects[0]).toMatchObject({ x: 120, y: 110 });
  });

  test("snaps the dragged object position to the grid", () => {
    const original = doc([rect("r1", 103, 107)]);
    const moved = moveObjectFromDragStartSnapped(
      original,
      "r1",
      { x: 20, y: 20 },
      { x: 43, y: 36 },
      10,
    );
    expect(moved.objects[0]).toMatchObject({ x: 130, y: 120 });
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

  test("resizes image object", () => {
    const d = doc([
      {
        id: "img1",
        type: "image",
        x: 100,
        y: 100,
        width: 160,
        height: 120,
        rotation: 0,
        zIndex: 1,
        src: "https://example.com/a.png",
        style: {},
      },
    ]);
    const resized = resizeObject(d, "img1", 320, 240);
    const obj = resized.objects.find((o) => o.id === "img1");
    expect(obj?.width).toBe(320);
    expect(obj?.height).toBe(240);
    if (obj?.type === "image") {
      expect(obj.src).toBe("https://example.com/a.png");
    }
  });
});

describe("insertImageObject", () => {
  test("inserts image object with sanitized src", () => {
    const d = doc([]);
    const out = insertImageObject(d, 100, 100, "https://example.com/a.png");
    const img = out.objects.find((o) => o.type === "image");
    expect(img).toBeDefined();
    expect(img?.x).toBe(100);
    expect(img?.y).toBe(100);
    expect(img?.src).toBe("https://example.com/a.png");
  });

  test("sanitizes unsafe src on insert", () => {
    const d = doc([]);
    const out = insertImageObject(d, 100, 100, "javascript:alert(1)");
    const img = out.objects.find((o) => o.type === "image");
    expect(img?.src).toBe("");
  });
});

describe("selectObject", () => {
  test("selects object at position", () => {
    const d = doc([rect("r1", 100, 100)]);
    const selected = selectObject(d, 150, 120);
    expect(selected?.id).toBe("r1");
  });

  test("selects image object at position", () => {
    const d = doc([
      {
        id: "img1",
        type: "image",
        x: 100,
        y: 100,
        width: 160,
        height: 120,
        rotation: 0,
        zIndex: 1,
        src: "https://example.com/a.png",
        style: {},
      },
    ]);
    const selected = selectObject(d, 150, 120);
    expect(selected?.id).toBe("img1");
  });

  test("returns undefined when nothing is hit", () => {
    const d = doc([rect("r1", 100, 100)]);
    const selected = selectObject(d, 500, 500);
    expect(selected).toBeUndefined();
  });

  test("picks topmost object on overlap", () => {
    const d = doc([rect("r1", 0, 0), rect("r2", 0, 0)]);
    const selected = selectObject(d, 10, 10);
    expect(selected?.id).toBe("r2");
  });
});

describe("deleteObjects", () => {
  test("deletes selected objects", () => {
    const d = doc([rect("r1", 0, 0), rect("r2", 100, 100)]);
    const deleted = deleteObjects(d, ["r1"]);
    expect(deleted.objects.length).toBe(1);
    expect(deleted.objects[0].id).toBe("r2");
  });

  test("moves image object", () => {
    const d = doc([
      {
        id: "img1",
        type: "image",
        x: 100,
        y: 100,
        width: 200,
        height: 80,
        rotation: 0,
        zIndex: 1,
        src: "data:image/png;base64,AAAA",
        style: {},
      },
    ]);
    const moved = moveObject(d, "img1", 20, 30);
    const obj = moved.objects.find((o) => o.id === "img1");
    expect(obj?.x).toBe(120);
    expect(obj?.y).toBe(130);
  });

  test("deletes curved connectors referencing deleted objects", () => {
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
        curve: true,
        from: { objectId: "r1" },
        to: { objectId: "r2" },
        style: {},
      },
    ]);
    const deleted = deleteObjects(d, ["r1"]);
    expect(deleted.objects.some((o) => o.id === "c1")).toBe(false);
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

describe("groupObjects", () => {
  test("groups selected objects into a single group", () => {
    const d = doc([rect("r1", 0, 0), rect("r2", 100, 50)]);
    const out = groupObjects(d, ["r1", "r2"]);
    expect(out.objects.length).toBe(1);
    const group = out.objects[0];
    expect(group.type).toBe("group");
    if (group.type === "group") {
      expect(group.members.length).toBe(2);
      expect(group.members.map((m) => m.id).sort()).toEqual(["r1", "r2"]);
    }
  });

  test("group bounding box covers all members", () => {
    const d = doc([rect("r1", 0, 0), rect("r2", 100, 50)]);
    const out = groupObjects(d, ["r1", "r2"]);
    const group = out.objects[0];
    expect(group.x).toBe(0);
    expect(group.y).toBe(0);
    expect(group.width).toBe(200);
    expect(group.height).toBe(100);
  });

  test("returns doc unchanged when no ids match", () => {
    const d = doc([rect("r1", 0, 0)]);
    const out = groupObjects(d, ["missing"]);
    expect(out).toBe(d);
  });
});

describe("ungroupObjects", () => {
  test("ungroups and restores members", () => {
    const d = doc([rect("r1", 0, 0), rect("r2", 100, 50)]);
    const grouped = groupObjects(d, ["r1", "r2"]);
    const out = ungroupObjects(grouped, grouped.objects[0].id);
    expect(out.objects.length).toBe(2);
    expect(out.objects.map((o) => o.id).sort()).toEqual(["r1", "r2"]);
  });

  test("returns doc unchanged when id is not a group", () => {
    const d = doc([rect("r1", 0, 0)]);
    const out = ungroupObjects(d, "r1");
    expect(out).toBe(d);
  });
});

describe("selectGroup", () => {
  test("selects group when hitting a member", () => {
    const d = doc([rect("r1", 0, 0), rect("r2", 100, 50)]);
    const grouped = groupObjects(d, ["r1", "r2"]);
    const selected = selectGroup(grouped, 150, 75);
    expect(selected?.type).toBe("group");
    expect(selected?.id).toBe(grouped.objects[0].id);
  });

  test("returns undefined when nothing is hit", () => {
    const d = doc([rect("r1", 0, 0), rect("r2", 100, 50)]);
    const grouped = groupObjects(d, ["r1", "r2"]);
    const selected = selectGroup(grouped, 500, 500);
    expect(selected).toBeUndefined();
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
