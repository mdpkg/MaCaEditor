import { describe, expect, test } from "vitest";

// Package-level regression tests stay next to the extracted core.
import { getBraceTailPoint, getCalloutTailPoint, getShapeDefinition, SHAPE_DEFINITIONS } from "./shapeRegistry";
import type { AutoShapeObject } from "./model";

describe("shape registry", () => {
  test("contains the requested basic, flowchart, and arrow shapes", () => {
    expect(SHAPE_DEFINITIONS.map((shape) => shape.id)).toEqual(expect.arrayContaining([
      "cylinder", "cube", "callout", "leftBrace", "rightBrace",
      "flowProcess", "flowDecision", "flowTerminator", "flowData",
      "flowDocument", "flowPredefinedProcess",
      "leftArrow", "rightArrow", "upArrow", "downArrow",
      "leftRightArrow", "upDownArrow", "arcArrow",
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

  test.each([
    [0, "138,70"],
    [90, "60,148"],
    [180, "-18,70"],
    [270, "60,-8"],
  ])("points the callout tail at %i degrees", (tailAngle, tip) => {
    const definition = getShapeDefinition("callout");
    const shape: AutoShapeObject = {
      id: "callout-1", type: "autoShape", preset: "callout",
      x: 10, y: 20, width: 100, height: 100,
      rotation: 0, zIndex: 1, style: {}, adjustments: { tailAngle },
    };

    expect(definition?.render(shape, "")).toContain(tip);
  });

  test("attaches a near-corner tail to the edge its tip is outside", () => {
    const definition = getShapeDefinition("callout");
    const shape: AutoShapeObject = {
      id: "callout-1", type: "autoShape", preset: "callout",
      x: 10, y: 20, width: 100, height: 100,
      rotation: 0, zIndex: 1, style: {}, adjustments: { tailAngle: 310 },
    };

    const rendered = definition?.render(shape, "") ?? "";
    const coordinates = [...rendered.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)]
      .map((match) => [Number(match[1]), Number(match[2])]);

    expect(coordinates[2][1]).toBeLessThan(20);
    expect(coordinates[1][1]).toBe(coordinates[3][1]);
  });

  test("uses the callout body, excluding its tail, as the shape bounds", () => {
    const definition = getShapeDefinition("callout");
    const shape: AutoShapeObject = {
      id: "callout-1", type: "autoShape", preset: "callout",
      x: 10, y: 20, width: 100, height: 80,
      rotation: 0, zIndex: 1, style: {}, adjustments: { tailAngle: 90 },
    };

    const rendered = definition?.render(shape, "") ?? "";

    expect(rendered).toContain("10,20 110,20 110,100");
    expect(rendered).toContain("60,122.4");
  });

  test("exposes the callout tail point for a GUI handle", () => {
    const shape: AutoShapeObject = {
      id: "callout-1", type: "autoShape", preset: "callout",
      x: 10, y: 20, width: 100, height: 80,
      rotation: 0, zIndex: 1, style: {}, adjustments: { tailAngle: 180 },
    };

    const tail = getCalloutTailPoint(shape);
    expect(tail[0]).toBeCloseTo(-12.4);
    expect(tail[1]).toBeCloseTo(60);
  });

  test.each([
    ["leftBrace", 15],
    ["rightBrace", 55],
  ])("renders %s with an adjustable tail point", (preset, expectedX) => {
    const definition = getShapeDefinition(preset);
    const shape: AutoShapeObject = {
      id: "brace-1", type: "autoShape", preset,
      x: 10, y: 20, width: 50, height: 100,
      rotation: 0, zIndex: 1, style: {}, adjustments: { tailPosition: 0.7 },
    };

    expect(definition?.render(shape, 'fill="#fff" stroke="#000"')).toContain("fill=\"none\"");
    expect(definition?.render(shape, 'fill="#fff" stroke="#000"')).toContain('stroke-linecap="round"');
    expect(getBraceTailPoint(shape)).toEqual([expectedX, 90]);
  });

  test("renders an elliptical arc arrow with adjustable start and sweep angles", () => {
    const definition = getShapeDefinition("arcArrow");
    const shape: AutoShapeObject = {
      id: "arc-1", type: "autoShape", preset: "arcArrow",
      x: 10, y: 20, width: 200, height: 100,
      rotation: 0, zIndex: 1,
      style: {}, adjustments: { startAngle: 0, sweepAngle: 90 },
    };

    const rendered = definition?.render(shape, 'fill="#fff" stroke="#123456"') ?? "";

    expect(rendered).toContain("A 84 38 0 0 1 110 108");
    expect(rendered).toContain('fill="#123456"');
    expect(rendered).toContain("<polygon");
  });

  test("renders independently configurable arc arrow end markers", () => {
    const definition = getShapeDefinition("arcArrow");
    const shape: AutoShapeObject = {
      id: "arc-1", type: "autoShape", preset: "arcArrow",
      x: 0, y: 0, width: 150, height: 100, rotation: 0, zIndex: 1,
      style: {}, startMarker: "crowFoot", endMarker: "none",
    };

    const rendered = definition?.render(shape, 'fill="#fff" stroke="#000"') ?? "";

    expect(rendered.match(/<path/g)).toHaveLength(2);
    expect(rendered).not.toContain("<polygon");
  });
});
