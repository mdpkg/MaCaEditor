import type { AutoShapeObject } from "./model";

export type ShapeCategory = "Basic" | "Flowchart" | "Arrows";

export interface ShapeDefinition {
  id: string;
  label: string;
  category: ShapeCategory;
  width: number;
  height: number;
  render: (shape: AutoShapeObject, attributes: string) => string;
}

const n = (value: number) => Number(value.toFixed(4));
const points = (values: Array<[number, number]>) =>
  values.map(([x, y]) => `${n(x)},${n(y)}`).join(" ");

function polygon(values: Array<[number, number]>, attributes: string): string {
  return `<polygon points="${points(values)}" ${attributes} />`;
}

function path(d: string, attributes: string): string {
  return `<path d="${d}" ${attributes} />`;
}

function calloutPoints(shape: AutoShapeObject): Array<[number, number]> {
  const angle = ((shape.adjustments?.tailAngle ?? 90) % 360 + 360) % 360;
  const radians = angle * Math.PI / 180;
  const dx = Math.cos(radians);
  const dy = Math.sin(radians);
  const left = shape.x;
  const right = shape.x + shape.width;
  const top = shape.y;
  const bottom = shape.y + shape.height;
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  const edgeScale = Math.min(
    Math.abs(dx) > 1e-6 ? shape.width / (2 * Math.abs(dx)) : Infinity,
    Math.abs(dy) > 1e-6 ? shape.height / (2 * Math.abs(dy)) : Infinity,
  );
  const tailLength = Math.min(shape.width, shape.height) * 0.28;
  const tipScale = edgeScale + tailLength;
  const tip: [number, number] = [centerX + dx * tipScale, centerY + dy * tipScale];
  const baseHalfX = shape.width * 0.07;
  const baseHalfY = shape.height * 0.09;
  const side = Math.abs(dx) * shape.height >= Math.abs(dy) * shape.width
    ? (dx >= 0 ? "right" : "left")
    : (dy >= 0 ? "bottom" : "top");

  if (side === "right" || side === "left") {
    const edge = side === "right" ? right : left;
    const edgeY = Math.max(top + baseHalfY, Math.min(bottom - baseHalfY, centerY + dy * (edge - centerX) / dx));
    if (side === "right") return [[left, top], [right, top], [right, edgeY - baseHalfY], tip, [right, edgeY + baseHalfY], [right, bottom], [left, bottom]];
    return [[left, top], [right, top], [right, bottom], [left, bottom], [left, edgeY + baseHalfY], tip, [left, edgeY - baseHalfY]];
  }

  const edge = side === "bottom" ? bottom : top;
  const edgeX = Math.max(left + baseHalfX, Math.min(right - baseHalfX, centerX + dx * (edge - centerY) / dy));
  if (side === "bottom") return [[left, top], [right, top], [right, bottom], [edgeX + baseHalfX, bottom], tip, [edgeX - baseHalfX, bottom], [left, bottom]];
  return [[left, top], [edgeX - baseHalfX, top], tip, [edgeX + baseHalfX, top], [right, top], [right, bottom], [left, bottom]];
}

export function getAutoShapeOutlinePoints(shape: AutoShapeObject): Array<[number, number]> {
  if (shape.preset === "callout") return calloutPoints(shape);
  return [
    [shape.x, shape.y],
    [shape.x + shape.width, shape.y],
    [shape.x + shape.width, shape.y + shape.height],
    [shape.x, shape.y + shape.height],
  ];
}

const definitions: ShapeDefinition[] = [
  {
    id: "cylinder", label: "Cylinder", category: "Basic", width: 120, height: 90,
    render: (s, a) => {
      const ry = Math.min(s.height * 0.14, 16);
      const cx = s.x + s.width / 2;
      const bottom = s.y + s.height;
      return `${path(`M ${s.x} ${s.y + ry} C ${s.x} ${s.y - ry / 3}, ${s.x + s.width} ${s.y - ry / 3}, ${s.x + s.width} ${s.y + ry} V ${bottom - ry} C ${s.x + s.width} ${bottom + ry / 3}, ${s.x} ${bottom + ry / 3}, ${s.x} ${bottom - ry} Z`, a)}<ellipse cx="${n(cx)}" cy="${n(s.y + ry)}" rx="${n(s.width / 2)}" ry="${n(ry)}" ${a} />`;
    },
  },
  {
    id: "cube", label: "Cube", category: "Basic", width: 100, height: 90,
    render: (s, a) => {
      const d = Math.min(s.width, s.height) * 0.2;
      const outer = polygon([[s.x, s.y + d], [s.x + d, s.y], [s.x + s.width, s.y], [s.x + s.width, s.y + s.height - d], [s.x + s.width - d, s.y + s.height], [s.x, s.y + s.height]], a);
      const lines = `<path d="M ${s.x} ${s.y + d} H ${s.x + s.width - d} L ${s.x + s.width} ${s.y} M ${s.x + s.width - d} ${s.y + d} V ${s.y + s.height} " fill="none" ${a.replace(/fill="[^"]*"(?: fill-opacity="[^"]*")?/, "")} />`;
      return outer + lines;
    },
  },
  {
    id: "callout", label: "Callout", category: "Basic", width: 140, height: 90,
    render: (s, a) => polygon(getAutoShapeOutlinePoints(s), a),
  },
  {
    id: "flowProcess", label: "Process", category: "Flowchart", width: 130, height: 70,
    render: (s, a) => `<rect x="${s.x}" y="${s.y}" width="${s.width}" height="${s.height}" ${a} />`,
  },
  {
    id: "flowDecision", label: "Decision", category: "Flowchart", width: 120, height: 90,
    render: (s, a) => polygon([[s.x + s.width / 2, s.y], [s.x + s.width, s.y + s.height / 2], [s.x + s.width / 2, s.y + s.height], [s.x, s.y + s.height / 2]], a),
  },
  {
    id: "flowTerminator", label: "Start / End", category: "Flowchart", width: 130, height: 60,
    render: (s, a) => `<rect x="${s.x}" y="${s.y}" width="${s.width}" height="${s.height}" rx="${s.height / 2}" ry="${s.height / 2}" ${a} />`,
  },
  {
    id: "flowData", label: "Data", category: "Flowchart", width: 130, height: 70,
    render: (s, a) => polygon([[s.x + s.width * 0.16, s.y], [s.x + s.width, s.y], [s.x + s.width * 0.84, s.y + s.height], [s.x, s.y + s.height]], a),
  },
  {
    id: "flowDocument", label: "Document", category: "Flowchart", width: 130, height: 80,
    render: (s, a) => path(`M ${s.x} ${s.y} H ${s.x + s.width} V ${s.y + s.height * 0.82} C ${s.x + s.width * 0.7} ${s.y + s.height * 0.62}, ${s.x + s.width * 0.32} ${s.y + s.height * 1.05}, ${s.x} ${s.y + s.height * 0.82} Z`, a),
  },
  {
    id: "flowPredefinedProcess", label: "Predefined Process", category: "Flowchart", width: 140, height: 70,
    render: (s, a) => `<rect x="${s.x}" y="${s.y}" width="${s.width}" height="${s.height}" ${a} /><path d="M ${s.x + s.width * 0.14} ${s.y} V ${s.y + s.height} M ${s.x + s.width * 0.86} ${s.y} V ${s.y + s.height}" fill="none" ${a.replace(/fill="[^"]*"(?: fill-opacity="[^"]*")?/, "")} />`,
  },
  {
    id: "leftArrow", label: "Left Arrow", category: "Arrows", width: 130, height: 70,
    render: (s, a) => polygon([[s.x, s.y + s.height / 2], [s.x + s.width * 0.38, s.y], [s.x + s.width * 0.38, s.y + s.height * 0.28], [s.x + s.width, s.y + s.height * 0.28], [s.x + s.width, s.y + s.height * 0.72], [s.x + s.width * 0.38, s.y + s.height * 0.72], [s.x + s.width * 0.38, s.y + s.height]], a),
  },
  {
    id: "rightArrow", label: "Right Arrow", category: "Arrows", width: 130, height: 70,
    render: (s, a) => polygon([[s.x + s.width, s.y + s.height / 2], [s.x + s.width * 0.62, s.y], [s.x + s.width * 0.62, s.y + s.height * 0.28], [s.x, s.y + s.height * 0.28], [s.x, s.y + s.height * 0.72], [s.x + s.width * 0.62, s.y + s.height * 0.72], [s.x + s.width * 0.62, s.y + s.height]], a),
  },
  {
    id: "upArrow", label: "Up Arrow", category: "Arrows", width: 70, height: 130,
    render: (s, a) => polygon([[s.x + s.width / 2, s.y], [s.x + s.width, s.y + s.height * 0.38], [s.x + s.width * 0.72, s.y + s.height * 0.38], [s.x + s.width * 0.72, s.y + s.height], [s.x + s.width * 0.28, s.y + s.height], [s.x + s.width * 0.28, s.y + s.height * 0.38], [s.x, s.y + s.height * 0.38]], a),
  },
  {
    id: "downArrow", label: "Down Arrow", category: "Arrows", width: 70, height: 130,
    render: (s, a) => polygon([[s.x + s.width / 2, s.y + s.height], [s.x + s.width, s.y + s.height * 0.62], [s.x + s.width * 0.72, s.y + s.height * 0.62], [s.x + s.width * 0.72, s.y], [s.x + s.width * 0.28, s.y], [s.x + s.width * 0.28, s.y + s.height * 0.62], [s.x, s.y + s.height * 0.62]], a),
  },
  {
    id: "leftRightArrow", label: "Left / Right Arrow", category: "Arrows", width: 150, height: 70,
    render: (s, a) => polygon([[s.x, s.y + s.height / 2], [s.x + s.width * 0.25, s.y], [s.x + s.width * 0.25, s.y + s.height * 0.28], [s.x + s.width * 0.75, s.y + s.height * 0.28], [s.x + s.width * 0.75, s.y], [s.x + s.width, s.y + s.height / 2], [s.x + s.width * 0.75, s.y + s.height], [s.x + s.width * 0.75, s.y + s.height * 0.72], [s.x + s.width * 0.25, s.y + s.height * 0.72], [s.x + s.width * 0.25, s.y + s.height]], a),
  },
  {
    id: "upDownArrow", label: "Up / Down Arrow", category: "Arrows", width: 70, height: 150,
    render: (s, a) => polygon([[s.x + s.width / 2, s.y], [s.x + s.width, s.y + s.height * 0.25], [s.x + s.width * 0.72, s.y + s.height * 0.25], [s.x + s.width * 0.72, s.y + s.height * 0.75], [s.x + s.width, s.y + s.height * 0.75], [s.x + s.width / 2, s.y + s.height], [s.x, s.y + s.height * 0.75], [s.x + s.width * 0.28, s.y + s.height * 0.75], [s.x + s.width * 0.28, s.y + s.height * 0.25], [s.x, s.y + s.height * 0.25]], a),
  },
];

export const SHAPE_DEFINITIONS = definitions;

export function getShapeDefinition(id: string): ShapeDefinition | undefined {
  return definitions.find((definition) => definition.id === id);
}

export function isAutoShapePreset(id: string): boolean {
  return getShapeDefinition(id) !== undefined;
}
