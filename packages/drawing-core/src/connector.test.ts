import { describe, expect, it } from "vitest";

// Package-level regression tests stay next to the extracted core.
import type { ConnectorObject, DrawingObject } from "./model";
import { connectorGeometry, isPointOnConnector } from "./connector";

const shapes: DrawingObject[] = [
  { id: "a", type: "rectangle", x: 0, y: 0, width: 100, height: 50, rotation: 0, zIndex: 1, style: {} },
  { id: "b", type: "rectangle", x: 300, y: 200, width: 100, height: 50, rotation: 0, zIndex: 1, style: {} },
];

function connector(curve: boolean, elbow = false): ConnectorObject {
  return {
    id: "c", type: "connector", x: 0, y: 0, width: 0, height: 0,
    rotation: 0, zIndex: 2, from: { objectId: "a" }, to: { objectId: "b" },
    curve, elbow, style: {},
  };
}

describe("connector hit testing", () => {
  it("selects a point near a straight connector", () => {
    const geometry = connectorGeometry(connector(false), shapes)!;
    expect(isPointOnConnector(geometry, 200, 125, 6)).toBe(true);
    expect(isPointOnConnector(geometry, 200, 160, 6)).toBe(false);
  });

  it("selects a point on a curved connector", () => {
    const geometry = connectorGeometry(connector(true), shapes)!;
    expect(isPointOnConnector(geometry, 211, 98, 8)).toBe(true);
    expect(isPointOnConnector(geometry, 200, 175, 8)).toBe(false);
  });

  it("aims the curved connector tail at the source anchor", () => {
    const geometry = connectorGeometry(connector(true), shapes)!;
    const tail = {
      x: geometry.c2!.x - geometry.to.x,
      y: geometry.c2!.y - geometry.to.y,
    };
    const towardSource = {
      x: geometry.from.x - geometry.to.x,
      y: geometry.from.y - geometry.to.y,
    };

    expect(tail.x * towardSource.y - tail.y * towardSource.x).toBeCloseTo(0);
    expect(tail.x * towardSource.x + tail.y * towardSource.y).toBeGreaterThan(0);
  });

  it("passes an adjusted curve through the central handle", () => {
    const adjusted = { ...connector(true), curveOffset: { x: -20, y: 80 } };
    const geometry = connectorGeometry(adjusted, shapes)!;

    expect(geometry.curveHandle).toEqual({ x: 180, y: 205 });
    expect(isPointOnConnector(geometry, 180, 205, 0.01)).toBe(true);
  });

  it("creates an orthogonal route and hit-tests every elbow segment", () => {
    const geometry = connectorGeometry(connector(false, true), shapes)!;

    expect(geometry.points).toEqual([
      { x: 100, y: 25 },
      { x: 200, y: 25 },
      { x: 200, y: 225 },
      { x: 300, y: 225 },
    ]);
    expect(isPointOnConnector(geometry, 200, 160, 6)).toBe(true);
    expect(isPointOnConnector(geometry, 230, 160, 6)).toBe(false);
  });

  it("returns no geometry when an endpoint is missing", () => {
    expect(connectorGeometry(connector(false), shapes.slice(0, 1))).toBeNull();
  });

  it("resolves an endpoint nested inside a group", () => {
    const groupedShapes: DrawingObject[] = [
      {
        id: "group-1", type: "group", x: 0, y: 0, width: 100, height: 50,
        rotation: 0, zIndex: 1, style: {}, members: [shapes[0]],
      },
      shapes[1],
    ];

    expect(connectorGeometry(connector(false), groupedShapes)).toMatchObject({
      from: { x: 100, y: 25 },
      to: { x: 300, y: 225 },
    });
  });

  it("connects to the rotated edge of a shape", () => {
    const rotatedShapes: DrawingObject[] = [
      { ...shapes[0], rotation: 90 },
      { ...shapes[1], x: 300, y: 0 },
    ];

    expect(connectorGeometry(connector(false), rotatedShapes)?.from).toMatchObject({
      x: 75,
      y: 25,
    });
  });
});
