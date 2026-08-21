import { describe, expect, it } from "vitest";
import { LINE_DASH_OPTIONS, LINE_WEIGHT_OPTIONS, svgLineStyle } from "./lineStyle";

describe("PowerPoint-compatible line styles", () => {
  it("offers the PowerPoint weight presets", () => {
    expect(LINE_WEIGHT_OPTIONS).toEqual([0.25, 0.5, 0.75, 1, 1.5, 2.25, 3, 4.5, 6]);
  });

  it("offers every supported Office dash variant", () => {
    expect(LINE_DASH_OPTIONS.map((option) => option.value)).toEqual([
      "solid", "squareDot", "roundDot", "dash", "dashDot", "dashDotDot",
      "longDash", "longDashDot", "longDashDotDot", "sysDash", "sysDot", "sysDashDot",
    ]);
  });

  it("renders a solid line without a dash array", () => {
    expect(svgLineStyle({ stroke: "#123456", strokeWidth: 2, dashStyle: "solid" }))
      .toBe('stroke="#123456" stroke-width="2"');
  });

  it("scales dash patterns with line weight", () => {
    expect(svgLineStyle({ stroke: "#000000", strokeWidth: 2, dashStyle: "dashDot" }))
      .toContain('stroke-dasharray="8 6 2 6"');
  });

  it("uses round caps for round dots", () => {
    expect(svgLineStyle({ stroke: "#000000", strokeWidth: 1, dashStyle: "roundDot" }))
      .toContain('stroke-linecap="round"');
  });

  it("renders independent stroke opacity", () => {
    expect(svgLineStyle({ stroke: "#123456", strokeOpacity: 0.4 }))
      .toContain('stroke-opacity="0.4"');
  });
});
