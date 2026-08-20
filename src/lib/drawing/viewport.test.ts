import { describe, expect, it } from "vitest";
import { clientToCanvasPoint, drawingViewport } from "./viewport";

describe("drawing viewport coordinates", () => {
  it("uses one stable canvas coordinate system at 100%", () => {
    expect(drawingViewport({ width: 1200, height: 800 }, 1)).toEqual({
      width: 1200,
      height: 800,
      viewBox: "0 0 1200 800",
    });
  });

  it("zooms physical size without changing the viewBox", () => {
    expect(drawingViewport({ width: 1200, height: 800 }, 2)).toEqual({
      width: 2400,
      height: 1600,
      viewBox: "0 0 1200 800",
    });
  });

  it("maps client coordinates through the actual rendered bounds", () => {
    expect(clientToCanvasPoint(
      { x: 650, y: 425 },
      { left: 50, top: 25, width: 2400, height: 1600 },
      { width: 1200, height: 800 },
    )).toEqual({ x: 300, y: 200 });
  });

  it("also handles a CSS-scaled canvas", () => {
    expect(clientToCanvasPoint(
      { x: 310, y: 220 },
      { left: 10, top: 20, width: 600, height: 400 },
      { width: 1200, height: 800 },
    )).toEqual({ x: 600, y: 400 });
  });
});
