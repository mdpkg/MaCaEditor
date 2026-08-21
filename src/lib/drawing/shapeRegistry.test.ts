import { describe, expect, test } from "vitest";
import { getShapeDefinition, SHAPE_DEFINITIONS } from "./shapeRegistry";
import type { AutoShapeObject } from "./model";

describe("shape registry", () => {
  test("contains the requested basic, flowchart, and arrow shapes", () => {
    expect(SHAPE_DEFINITIONS.map((shape) => shape.id)).toEqual(expect.arrayContaining([
      "cylinder", "cube", "callout",
      "flowProcess", "flowDecision", "flowTerminator", "flowData",
      "flowDocument", "flowPredefinedProcess",
      "leftArrow", "rightArrow", "upArrow", "downArrow",
      "leftRightArrow", "upDownArrow",
    ]));
  });

  test.each(SHAPE_DEFINITIONS)("renders $id inside its bounds", (definition) => {
    const shape: AutoShapeObject = {
      id: "shape-1", type: "autoShape", preset: definition.id,
      x: 10, y: 20, width: definition.width, height: definition.height,
      rotation: 0, zIndex: 1, style: {}, text: "",
    };
    expect(definition.render(shape, 'fill="#fff" stroke="#000"')).toMatch(/^<(?:path|polygon|rect)/);
  });

  test("returns undefined for an unknown preset", () => {
    expect(getShapeDefinition("unknown")).toBeUndefined();
  });
});
