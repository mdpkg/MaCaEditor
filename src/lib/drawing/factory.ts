import type { DrawingDocument, DrawingObject } from "./model";
import { sanitizeImageSrc } from "../sanitize";

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
  | "ellipse"
  | "text"
  | "line"
  | "arrow"
  | "image"
  | "connector";

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
        style: { stroke: "#000000", strokeWidth: 1 },
      };
    case "select":
      throw new Error("select tool does not create objects");
  }
}
