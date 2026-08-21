import { describe, expect, test } from "vitest";
import type { DrawingDocument, DrawingObject } from "./model";
import {
  alignObjects,
  bringForward,
  bringToFront,
  deleteObjects,
  findObjectById,
  groupObjects,
  insertImageObject,
  moveObject,
  moveObjectFromDragStart,
  moveObjectFromDragStartSnapped,
  moveObjectsFromDragStart,
  moveObjectsFromDragStartSnapped,
  resizeCanvasFromDrag,
  resizeObject,
  resizeObjectFromDragStart,
  rotateObjectFromDragStart,
  redo,
  selectGroup,
  selectObject,
  selectObjectsInRect,
  sendBackward,
  sendToBack,
  ungroupObjects,
  undo,
  updateConnectorEnds,
  updateObjectRotation,
  updateAutoShapeAdjustment,
  updateAutoShapeEnds,
  updateObjectOpacity,
  updateShapeText,
  updateShapeTextAlignment,
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
  test("finds and moves an object nested in a group", () => {
    const child = rect("child", 100, 100);
    const grouped = doc([{
      id: "group-1", type: "group", x: 100, y: 100, width: 100, height: 50,
      rotation: 0, zIndex: 1, style: {}, members: [child],
    }]);

    expect(findObjectById(grouped.objects, "child")).toBe(child);

    const moved = moveObject(grouped, "child", 20, 30);
    expect(findObjectById(moved.objects, "child")).toMatchObject({ x: 120, y: 130 });
    expect(moved.objects[0]).toMatchObject({
      id: "group-1", x: 120, y: 130, width: 100, height: 50,
    });
  });

  test("updates every ancestor group boundary after moving a nested object", () => {
    const child = rect("child", 100, 100);
    const grouped = doc([{
      id: "outer", type: "group", x: 80, y: 80, width: 140, height: 100,
      rotation: 0, zIndex: 1, style: {}, members: [{
        id: "inner", type: "group", x: 100, y: 100, width: 80, height: 40,
        rotation: 0, zIndex: 1, style: {}, members: [child],
      }],
    }]);

    const moved = moveObject(grouped, "child", 50, 20);
    expect(findObjectById(moved.objects, "inner")).toMatchObject({
      x: 150, y: 120, width: 100, height: 50,
    });
    expect(findObjectById(moved.objects, "outer")).toMatchObject({
      x: 150, y: 120, width: 100, height: 50,
    });
  });

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

  test("moves every selected object by the same drag delta", () => {
    const original = doc([rect("r1", 100, 100), rect("r2", 260, 180)]);
    const moved = moveObjectsFromDragStart(
      original,
      ["r1", "r2"],
      { x: 110, y: 110 },
      { x: 145, y: 130 },
    );

    expect(moved.objects[0]).toMatchObject({ x: 135, y: 120 });
    expect(moved.objects[1]).toMatchObject({ x: 295, y: 200 });
  });

  test("snaps a group using the dragged object as its anchor", () => {
    const original = doc([rect("r1", 103, 107), rect("r2", 263, 187)]);
    const moved = moveObjectsFromDragStartSnapped(
      original,
      ["r1", "r2"],
      "r1",
      { x: 110, y: 110 },
      { x: 135, y: 128 },
      10,
    );

    expect(moved.objects[0]).toMatchObject({ x: 130, y: 130 });
    expect(moved.objects[1]).toMatchObject({ x: 290, y: 210 });
  });

  test("moves both endpoints of a selected line", () => {
    const line: DrawingObject = {
      id: "line-1", type: "line", x: 10, y: 20, x2: 80, y2: 90,
      width: 0, height: 0, rotation: 0, zIndex: 1, style: {},
    };
    const moved = moveObjectsFromDragStart(
      doc([line]),
      ["line-1"],
      { x: 10, y: 20 },
      { x: 40, y: 60 },
    );

    expect(moved.objects[0]).toMatchObject({ x: 40, y: 60, x2: 110, y2: 130 });
  });
});

describe("selectObjectsInRect", () => {
  test("selects shapes and lines fully contained in a normalized drag rectangle", () => {
    const line: DrawingObject = {
      id: "line-1", type: "line", x: 250, y: 100, x2: 320, y2: 150,
      width: 0, height: 0, rotation: 0, zIndex: 2, style: {},
    };
    const selected = selectObjectsInRect(
      doc([rect("inside", 100, 100), rect("outside", 500, 500), line]),
      { x: 350, y: 200 },
      { x: 80, y: 80 },
    );

    expect(selected).toEqual(["inside", "line-1"]);
  });

  test("does not select a partially intersecting shape", () => {
    expect(selectObjectsInRect(
      doc([rect("partial", 100, 100)]),
      { x: 190, y: 120 },
      { x: 220, y: 160 },
    )).toEqual([]);
  });

  test("selects a rotated shape only when all rotated corners are contained", () => {
    const rotated = { ...rect("rotated", 100, 100), rotation: 45 };

    expect(selectObjectsInRect(
      doc([rotated]),
      { x: 80, y: 60 },
      { x: 220, y: 240 },
    )).toEqual(["rotated"]);
    expect(selectObjectsInRect(
      doc([rotated]),
      { x: 100, y: 100 },
      { x: 200, y: 200 },
    )).toEqual([]);
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

describe("resizeObjectFromDragStart", () => {
  test("resizes from the bottom-right handle", () => {
    const original = doc([rect("r1", 100, 100)]);
    const resized = resizeObjectFromDragStart(
      original,
      "r1",
      "se",
      { x: 200, y: 150 },
      { x: 247, y: 183 },
      true,
    );

    expect(resized.objects[0]).toMatchObject({ x: 100, y: 100, width: 150, height: 80 });
  });

  test("keeps the opposite corner fixed when resizing from top-left", () => {
    const original = doc([rect("r1", 100, 100)]);
    const resized = resizeObjectFromDragStart(
      original,
      "r1",
      "nw",
      { x: 100, y: 100 },
      { x: 130, y: 120 },
      false,
    );

    expect(resized.objects[0]).toMatchObject({ x: 130, y: 120, width: 70, height: 30 });
  });

  test("does not invert an object when dragged past its opposite edge", () => {
    const original = doc([rect("r1", 100, 100)]);
    const resized = resizeObjectFromDragStart(
      original,
      "r1",
      "w",
      { x: 100, y: 125 },
      { x: 250, y: 125 },
      false,
    );

    expect(resized.objects[0]).toMatchObject({ x: 190, width: 10 });
  });

  test("resizes an image without losing its source", () => {
    const image: DrawingObject = {
      id: "image-1",
      type: "image",
      x: 20,
      y: 30,
      width: 160,
      height: 120,
      rotation: 0,
      zIndex: 1,
      src: "data:image/png;base64,AQID",
      style: {},
    };
    const resized = resizeObjectFromDragStart(
      doc([image]),
      "image-1",
      "e",
      { x: 180, y: 90 },
      { x: 240, y: 90 },
      false,
    );

    expect(resized.objects[0]).toMatchObject({
      width: 220,
      height: 120,
      src: "data:image/png;base64,AQID",
    });
  });
});

describe("resizeCanvasFromDrag", () => {
  test("resizes both dimensions from the bottom-right edge", () => {
    const resized = resizeCanvasFromDrag(doc([]), "both", 137, -53, true);

    expect(resized.canvas).toMatchObject({ width: 1340, height: 750, fitToContent: false });
  });

  test("resizes only the dragged edge", () => {
    const resized = resizeCanvasFromDrag(doc([]), "width", 25, 200, false);

    expect(resized.canvas).toMatchObject({ width: 1225, height: 800, fitToContent: false });
  });

  test("keeps the canvas large enough to remain draggable", () => {
    const resized = resizeCanvasFromDrag(doc([]), "both", -2000, -2000, true);

    expect(resized.canvas).toMatchObject({ width: 100, height: 100 });
  });
});

describe("updateConnectorEnds", () => {
  test("updates the start and end independently", () => {
    const connector: DrawingObject = {
      id: "c1", type: "connector", x: 0, y: 0, width: 0, height: 0,
      rotation: 0, zIndex: 1, from: { objectId: "a" }, to: { objectId: "b" }, style: {},
    };

    const updated = updateConnectorEnds(doc([connector]), "c1", "crowFoot", "arrow");

    expect(updated.objects[0]).toMatchObject({ startMarker: "crowFoot", endMarker: "arrow" });
  });
});

describe("updateObjectRotation", () => {
  test("rotates a shape by degrees", () => {
    const updated = updateObjectRotation(doc([rect("r1", 100, 80)]), "r1", 45);

    expect(updated.objects[0].rotation).toBe(45);
  });
});

describe("updateAutoShapeAdjustment", () => {
  test("updates an auto shape adjustment", () => {
    const original = doc([{
      id: "callout-1", type: "autoShape", preset: "callout",
      x: 0, y: 0, width: 100, height: 80, rotation: 0, zIndex: 1,
      style: {},
    }]);

    const updated = updateAutoShapeAdjustment(original, "callout-1", "tailAngle", 275);

    expect(updated.objects[0]).toMatchObject({ adjustments: { tailAngle: 275 } });
  });
});

describe("updateAutoShapeEnds", () => {
  test("updates both end markers of an auto shape", () => {
    const original = doc([{
      id: "arc-1", type: "autoShape", preset: "arcArrow",
      x: 0, y: 0, width: 100, height: 80, rotation: 0, zIndex: 1,
      style: {},
    }]);

    const updated = updateAutoShapeEnds(original, "arc-1", "crowFoot", "none");

    expect(updated.objects[0]).toMatchObject({ startMarker: "crowFoot", endMarker: "none" });
  });
});

describe("updateObjectOpacity", () => {
  test("updates fill and stroke opacity independently and clamps values", () => {
    const original = doc([rect("r1", 0, 0)]);
    const fill = updateObjectOpacity(original, ["r1"], "fill", 0.25);
    const stroke = updateObjectOpacity(fill, ["r1"], "stroke", 2);

    expect(stroke.objects[0].style).toMatchObject({ fillOpacity: 0.25, strokeOpacity: 1 });
  });
});

describe("rotateObjectFromDragStart", () => {
  test("rotates around the object center from the drag angle", () => {
    const original = doc([rect("r1", 100, 100)]);

    const rotated = rotateObjectFromDragStart(
      original,
      "r1",
      { x: 150, y: 50 },
      { x: 200, y: 125 },
      false,
    );

    expect(rotated.objects[0].rotation).toBeCloseTo(90);
  });

  test("snaps rotation to 15 degree increments", () => {
    const original = doc([{ ...rect("r1", 100, 100), rotation: 10 }]);

    const rotated = rotateObjectFromDragStart(
      original,
      "r1",
      { x: 150, y: 50 },
      { x: 175, y: 60 },
      true,
    );

    expect(rotated.objects[0].rotation % 15).toBe(0);
  });
});

describe("updateShapeText", () => {
  test.each(["rectangle", "roundedRectangle", "ellipse", "file", "user"] as const)(
    "writes text into a %s shape",
    (type) => {
      const shape = {
        ...rect("shape", 100, 100),
        type,
        ...(type === "roundedRectangle" ? { cornerRadius: 12 } : {}),
        text: "",
      } as DrawingObject;
      const updated = updateShapeText(doc([shape]), "shape", "日本語テキスト");
      expect(updated.objects[0]).toMatchObject({ text: "日本語テキスト" });
    },
  );

  test("does not add text to a line", () => {
    const line: DrawingObject = {
      id: "line", type: "line", x: 0, y: 0, x2: 100, y2: 100,
      width: 0, height: 0, rotation: 0, zIndex: 1, style: {},
    };
    expect(updateShapeText(doc([line]), "line", "ignored").objects[0]).not.toHaveProperty("text");
  });
});

describe("updateShapeTextAlignment", () => {
  test("updates horizontal and vertical alignment on a shape", () => {
    const shape = { ...rect("shape", 100, 100), text: "Label" } as DrawingObject;

    const updated = updateShapeTextAlignment(doc([shape]), "shape", "right", "bottom");

    expect(updated.objects[0]).toMatchObject({
      textStyle: { align: "right", verticalAlign: "bottom" },
    });
  });

  test("does not add shape alignment to a standalone text object", () => {
    const text: DrawingObject = {
      id: "text-1", type: "text", x: 0, y: 0, width: 100, height: 20,
      rotation: 0, zIndex: 1, text: "Label", style: {},
    };

    expect(updateShapeTextAlignment(doc([text]), "text-1", "left", "top")).toEqual(doc([text]));
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

  test("deletes a group, all descendants, and connectors referencing them", () => {
    const child = rect("child", 0, 0);
    const group: DrawingObject = {
      id: "group-1", type: "group", x: 0, y: 0, width: 100, height: 50,
      rotation: 0, zIndex: 1, style: {}, members: [child],
    };
    const outside = rect("outside", 200, 0);
    const connector: DrawingObject = {
      id: "connector-1", type: "connector", x: 0, y: 0, width: 0, height: 0,
      rotation: 0, zIndex: 2, from: { objectId: "child" },
      to: { objectId: "outside" }, style: {},
    };

    const deleted = deleteObjects(doc([group, outside, connector]), ["group-1"]);

    expect(deleted.objects.map((object) => object.id)).toEqual(["outside"]);
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
  test("includes a connector when both connected shapes are grouped", () => {
    const connector: DrawingObject = {
      id: "connector-1",
      type: "connector",
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      rotation: 0,
      zIndex: 3,
      from: { objectId: "r1" },
      to: { objectId: "r2" },
      style: { stroke: "#000000", strokeWidth: 1 },
    };

    const out = groupObjects(
      doc([rect("r1", 0, 0), rect("r2", 100, 50), connector]),
      ["r1", "r2"],
    );

    expect(out.objects).toHaveLength(1);
    expect(out.objects[0].type).toBe("group");
    if (out.objects[0].type === "group") {
      expect(out.objects[0].members.map((member) => member.id).sort()).toEqual([
        "connector-1",
        "r1",
        "r2",
      ]);
    }
  });

  test("does not include a connector when only one endpoint is grouped", () => {
    const connector: DrawingObject = {
      id: "connector-1",
      type: "connector",
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      rotation: 0,
      zIndex: 3,
      from: { objectId: "r1" },
      to: { objectId: "outside" },
      style: {},
    };

    const out = groupObjects(
      doc([rect("r1", 0, 0), rect("r2", 100, 50), rect("outside", 300, 50), connector]),
      ["r1", "r2"],
    );

    expect(out.objects.some((object) => object.id === "connector-1")).toBe(true);
  });

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

  test("moves the group and all of its members together", () => {
    const grouped = groupObjects(doc([rect("r1", 0, 0), rect("r2", 100, 50)]), ["r1", "r2"]);
    const group = grouped.objects[0];

    const moved = moveObject(grouped, group.id, 30, 20);
    const movedGroup = moved.objects[0];

    expect(movedGroup).toMatchObject({ x: 30, y: 20 });
    expect(movedGroup.type).toBe("group");
    if (movedGroup.type === "group") {
      expect(movedGroup.members[0]).toMatchObject({ x: 30, y: 20 });
      expect(movedGroup.members[1]).toMatchObject({ x: 130, y: 70 });
    }
  });
});

describe("ungroupObjects", () => {
  test("preserves a connector between grouped shapes after ungrouping", () => {
    const connector: DrawingObject = {
      id: "connector-1", type: "connector", x: 0, y: 0, width: 0, height: 0,
      rotation: 0, zIndex: 3, from: { objectId: "r1" }, to: { objectId: "r2" }, style: {},
    };
    const grouped = groupObjects(
      doc([rect("r1", 0, 0), rect("r2", 100, 50), connector]),
      ["r1", "r2"],
    );

    const out = ungroupObjects(grouped, grouped.objects[0].id);

    expect(out.objects.map((object) => object.id).sort()).toEqual([
      "connector-1",
      "r1",
      "r2",
    ]);
    expect(out.objects.find((object) => object.id === "connector-1")).toMatchObject({
      from: { objectId: "r1" },
      to: { objectId: "r2" },
    });
  });

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

  test("restores members at their moved positions", () => {
    const grouped = groupObjects(doc([rect("r1", 0, 0), rect("r2", 100, 50)]), ["r1", "r2"]);
    const moved = moveObject(grouped, grouped.objects[0].id, 30, 20);

    const out = ungroupObjects(moved, moved.objects[0].id);

    expect(out.objects[0]).toMatchObject({ id: "r1", x: 30, y: 20 });
    expect(out.objects[1]).toMatchObject({ id: "r2", x: 130, y: 70 });
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
