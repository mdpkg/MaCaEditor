import { describe, expect, test } from "vitest";
import { distributeObjects, smartGuideMove } from "./layout";
import type { DrawingDocument, RectangleObject } from "./model";

const rect = (id: string, x: number, y: number, width = 20): RectangleObject => ({
  id, type: "rectangle", x, y, width, height: 20, rotation: 0, zIndex: 1, style: {},
});
const doc = (...objects: DrawingDocument["objects"]): DrawingDocument => ({
  format: "maca-drawing", version: "1.0", canvas: { width: 800, height: 600, gridSize: 10 }, objects,
});

describe("equal gaps", () => {
  test("keeps the outside objects fixed and equalizes gaps between different widths", () => {
    const original = doc(rect("a", 0, 0), rect("b", 30, 80, 40), rect("c", 120, 10));
    const result = distributeObjects(original, ["c", "a", "b"], "horizontal");
    expect(result.objects.map(o => o.x)).toEqual([0, 50, 120]);
    expect(result.objects.map(o => o.y)).toEqual([0, 80, 10]);
    expect(original.objects[1].x).toBe(30);
  });
  test("distributes vertically and leaves unselected objects alone", () => {
    const original = doc(rect("a", 0, 0), rect("b", 30, 25), rect("c", 120, 100), rect("d", 2, 12));
    expect(distributeObjects(original, ["a", "b", "c"], "vertical").objects.map(o => o.y)).toEqual([0, 50, 100, 12]);
    expect(distributeObjects(original, ["a", "b"], "vertical")).toBe(original);
  });
  test("translates group members with their group", () => {
    const original = doc(rect("a", 0, 0), {
      ...rect("g", 30, 0), type: "group", members: [rect("child", 30, 0)],
    }, rect("c", 120, 0));
    const result = distributeObjects(original, ["a", "g", "c"], "horizontal");
    expect(result.objects[1]).toMatchObject({ x: 60, members: [{ x: 60 }] });
  });
});

describe("smart guides", () => {
  test("snaps near an edge and reports its guide", () => {
    const original = doc(rect("a", 0, 0), rect("b", 100, 100));
    const result = smartGuideMove(original, ["a"], { x: 97, y: 40 }, 6);
    expect(result.delta).toEqual({ x: 100, y: 40 });
    expect(result.guides).toContainEqual(expect.objectContaining({ axis: "x", value: 100 }));
  });
  test("aligns centers of different size objects", () => {
    const original = doc(rect("a", 0, 0, 40), rect("b", 100, 100));
    expect(smartGuideMove(original, ["a"], { x: 88, y: 40 }, 3).delta.x).toBe(90);
  });
  test("uses tolerance in canvas coordinates and preserves movement outside it", () => {
    const original = doc(rect("a", 0, 0), rect("b", 100, 100));
    expect(smartGuideMove(original, ["a"], { x: 96, y: 40 }, 3)).toEqual({ delta: { x: 96, y: 40 }, guides: [] });
  });
  test("does not snap a group to its own children", () => {
    const original = doc({ ...rect("g", 0, 0), type: "group", members: [rect("child", 0, 0)] });
    expect(smartGuideMove(original, ["g"], { x: 2, y: 2 }, 6).guides).toEqual([]);
  });
});
