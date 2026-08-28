import type { DrawingDocument, DrawingObject } from "./model";
import { sanitizeImageSrc } from "./sanitizeImageSrc";
import { getShapeDefinition } from "./shapeRegistry";

/** 新しい一意 ID を生成する。 */
export function newId(prefix: string, existing: Set<string>): string {
  let n = 1;
  let id = `${prefix}-${n}`;
  while (existing.has(id)) {
    n += 1;
    id = `${prefix}-${n}`;
  }
  return id;
}

export type ToolKind =
  | "select"
  | "rectangle"
  | "roundedRectangle"
  | "ellipse"
  | "file"
  | "user"
  | "text"
  | "line"
  | "arrow"
  | "image"
  | "connector"
  | "curveConnector"
  | "elbowConnector"
  | `autoShape:${string}`;

/** 四角形オブジェクトを生成する。 */
export function createRectangleObject(
  doc: DrawingDocument,
  x: number,
  y: number,
): DrawingObject {
  const existing = new Set(doc.objects.map((o) => o.id));
  const id = newId("rectangle", existing);
  const zIndex = Math.max(0, ...doc.objects.map((o) => o.zIndex)) + 1;
  return {
    id,
    type: "rectangle",
    x,
    y,
    width: 120,
    height: 60,
    rotation: 0,
    zIndex,
    style: { fill: "#ffffff", stroke: "#000000", strokeWidth: 1 },
    text: "",
  };
}

/** 楕円オブジェクトを生成する。 */
export function createEllipseObject(
  doc: DrawingDocument,
  x: number,
  y: number,
): DrawingObject {
  const existing = new Set(doc.objects.map((o) => o.id));
  const id = newId("ellipse", existing);
  const zIndex = Math.max(0, ...doc.objects.map((o) => o.zIndex)) + 1;
  return {
    id,
    type: "ellipse",
    x,
    y,
    width: 120,
    height: 60,
    rotation: 0,
    zIndex,
    style: { fill: "#ffffff", stroke: "#000000", strokeWidth: 1 },
    text: "",
  };
}

/** 曲線コネクタを生成する。 */
export function createCurvedConnector(
  doc: DrawingDocument,
  fromId: string,
  toId: string,
): DrawingObject {
  const existing = new Set(doc.objects.map((o) => o.id));
  const id = newId("connector", existing);
  const zIndex = Math.max(0, ...doc.objects.map((o) => o.zIndex)) + 1;
  return {
    id,
    type: "connector",
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    rotation: 0,
    zIndex,
    from: { objectId: fromId },
    to: { objectId: toId },
    curve: true,
    style: { stroke: "#000000", strokeWidth: 1 },
  };
}

/** 2つのシェイプを参照する一意なコネクタを生成する。 */
export function createConnector(
  doc: DrawingDocument,
  fromId: string,
  toId: string,
  curve: boolean,
  elbow = false,
): DrawingObject {
  if (fromId === toId) throw new Error("Connector endpoints must be different shapes");
  const from = doc.objects.find((object) => object.id === fromId && object.type !== "connector");
  const to = doc.objects.find((object) => object.id === toId && object.type !== "connector");
  if (!from || !to) throw new Error("Connector endpoints must reference shapes");
  const existing = new Set(doc.objects.map((object) => object.id));
  return {
    id: newId("connector", existing),
    type: "connector",
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    rotation: 0,
    zIndex: Math.max(0, ...doc.objects.map((object) => object.zIndex)) + 1,
    from: { objectId: fromId },
    to: { objectId: toId },
    curve,
    elbow,
    style: { stroke: "#000000", strokeWidth: 1 },
  };
}

/** 画像オブジェクトを生成し、src をサニタイズする。 */
export function createImageObject(
  doc: DrawingDocument,
  x: number,
  y: number,
  src: string,
): DrawingObject {
  const existing = new Set(doc.objects.map((o) => o.id));
  const id = newId("image", existing);
  const zIndex = Math.max(0, ...doc.objects.map((o) => o.zIndex)) + 1;
  return {
    id,
    type: "image",
    x,
    y,
    width: 160,
    height: 120,
    rotation: 0,
    zIndex,
    src: sanitizeImageSrc(src),
    style: {},
  };
}

/** ツールに応じた新しいオブジェクトを生成する。 */
export function createObject(
  doc: DrawingDocument,
  tool: ToolKind,
  x: number,
  y: number,
): DrawingObject {
  if (tool.startsWith("autoShape:")) {
    const preset = tool.slice("autoShape:".length);
    const definition = getShapeDefinition(preset);
    if (!definition) throw new Error(`unknown auto shape preset: ${preset}`);
    const existing = new Set(doc.objects.map((object) => object.id));
    return {
      id: newId(preset, existing),
      type: "autoShape",
      preset,
      x,
      y,
      width: definition.width,
      height: definition.height,
      rotation: 0,
      zIndex: Math.max(0, ...doc.objects.map((object) => object.zIndex)) + 1,
      style: { fill: "#ffffff", stroke: "#000000", strokeWidth: 1 },
      text: "",
    };
  }
  const existing = new Set(doc.objects.map((o) => o.id));
  const id = newId(tool, existing);
  const zIndex = Math.max(0, ...doc.objects.map((o) => o.zIndex)) + 1;

  switch (tool) {
    case "rectangle":
      return {
        id,
        type: "rectangle",
        x,
        y,
        width: 120,
        height: 60,
        rotation: 0,
        zIndex,
        style: { fill: "#ffffff", stroke: "#000000", strokeWidth: 1 },
        text: "",
      };
    case "roundedRectangle":
      return {
        id,
        type: "roundedRectangle",
        x,
        y,
        width: 120,
        height: 60,
        cornerRadius: 12,
        rotation: 0,
        zIndex,
        style: { fill: "#ffffff", stroke: "#000000", strokeWidth: 1 },
        text: "",
      };
    case "ellipse":
      return {
        id,
        type: "ellipse",
        x,
        y,
        width: 120,
        height: 60,
        rotation: 0,
        zIndex,
        style: { fill: "#ffffff", stroke: "#000000", strokeWidth: 1 },
        text: "",
      };
    case "file":
    case "user":
      return {
        id,
        type: tool,
        x,
        y,
        width: 120,
        height: 80,
        rotation: 0,
        zIndex,
        style: { fill: "#ffffff", stroke: "#000000", strokeWidth: 1 },
        text: "",
      };
    case "text":
      return {
        id,
        type: "text",
        x,
        y,
        width: 100,
        height: 20,
        rotation: 0,
        zIndex,
        text: "Text",
        style: { fontSize: 16, color: "#000000" },
      };
    case "line":
      return {
        id,
        type: "line",
        x,
        y,
        width: 0,
        height: 0,
        rotation: 0,
        zIndex,
        x2: x + 100,
        y2: y + 100,
        style: { stroke: "#000000", strokeWidth: 1 },
      };
    case "arrow":
      return {
        id,
        type: "arrow",
        x,
        y,
        width: 0,
        height: 0,
        rotation: 0,
        zIndex,
        x2: x + 100,
        y2: y + 100,
        style: { stroke: "#000000", strokeWidth: 1 },
      };
    case "image":
      return {
        id,
        type: "image",
        x,
        y,
        width: 160,
        height: 120,
        rotation: 0,
        zIndex,
        src: "",
        style: {},
      };
    case "connector":
    case "curveConnector":
    case "elbowConnector":
      return {
        id,
        type: "connector",
        x,
        y,
        width: 0,
        height: 0,
        rotation: 0,
        zIndex,
        from: { objectId: "" },
        to: { objectId: "" },
        curve: tool === "curveConnector",
        elbow: tool === "elbowConnector",
        style: { stroke: "#000000", strokeWidth: 1 },
      };
    case "select":
      throw new Error("select tool does not create objects");
    default:
      throw new Error(`unknown drawing tool: ${tool}`);
  }
}
