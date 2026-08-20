import { describe, expect, it } from "vitest";
import type { ConnectorObject, DrawingObject } from "./model";
import { connectorGeometry, isPointOnConnector } from "./connector";

const shapes: DrawingObject[] = [
  { id: "a", type: "rectangle", x: 0, y: 0, width: 100, height: 50, rotation: 0, zIndex: 1, style: {} },
  { id: "b", type: "rectangle", x: 300, y: 200, width: 100, height: 50, rotation: 0, zIndex: 1, style: {} },
];

function connector(curve: boolean): ConnectorObject {
  return {
    id: "c", type: "connector", x: 0, y: 0, width: 0, height: 0,
    rotation: 0, zIndex: 2, from: { objectId: "a" }, to: { objectId: "b" },
    curve, style: {},
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
    expect(isPointOnConnector(geometry, 200, 125, 8)).toBe(true);
    expect(isPointOnConnector(geometry, 200, 175, 8)).toBe(false);
  });

  it("returns no geometry when an endpoint is missing", () => {
    expect(connectorGeometry(connector(false), shapes.slice(0, 1))).toBeNull();
  });
});
