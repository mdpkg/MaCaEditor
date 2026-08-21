import type { LineDashStyle, ObjectStyle } from "./model";

export const LINE_WEIGHT_OPTIONS = [0.25, 0.5, 0.75, 1, 1.5, 2.25, 3, 4.5, 6] as const;

export const LINE_DASH_OPTIONS: ReadonlyArray<{ value: LineDashStyle; label: string }> = [
  { value: "solid", label: "Solid" },
  { value: "squareDot", label: "Square Dot" },
  { value: "roundDot", label: "Round Dot" },
  { value: "dash", label: "Dash" },
  { value: "dashDot", label: "Dash Dot" },
  { value: "dashDotDot", label: "Dash Dot Dot" },
  { value: "longDash", label: "Long Dash" },
  { value: "longDashDot", label: "Long Dash Dot" },
  { value: "longDashDotDot", label: "Long Dash Dot Dot" },
  { value: "sysDash", label: "System Dash" },
  { value: "sysDot", label: "System Dot" },
  { value: "sysDashDot", label: "System Dash Dot" },
];

const PATTERNS: Partial<Record<LineDashStyle, number[]>> = {
  squareDot: [1, 3],
  roundDot: [0, 3],
  dash: [4, 3],
  dashDot: [4, 3, 1, 3],
  dashDotDot: [4, 3, 1, 3, 1, 3],
  longDash: [8, 3],
  longDashDot: [8, 3, 1, 3],
  longDashDotDot: [8, 3, 1, 3, 1, 3],
  sysDash: [3, 1],
  sysDot: [1, 1],
  sysDashDot: [3, 1, 1, 1],
};

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function svgLineStyle(style: ObjectStyle): string {
  const stroke = escapeAttribute(style.stroke ?? "#000000");
  const width = style.strokeWidth ?? 1;
  const dashStyle = style.dashStyle ?? "solid";
  const pattern = PATTERNS[dashStyle];
  const dash = pattern
    ? ` stroke-dasharray="${pattern.map((part) => part * width).join(" ")}"`
    : "";
  const cap = dashStyle === "roundDot" ? ' stroke-linecap="round"' : "";
  const opacity = style.strokeOpacity === undefined
    ? ""
    : ` stroke-opacity="${Math.max(0, Math.min(1, style.strokeOpacity))}"`;
  return `stroke="${stroke}" stroke-width="${width}"${opacity}${dash}${cap}`;
}
