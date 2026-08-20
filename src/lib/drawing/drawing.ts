import type {
  ArrowObject,
  ConnectorObject,
  DrawingDocument,
  DrawingObject,
  EllipseObject,
  GroupObject,
  ImageObject,
  LineObject,
  RectangleObject,
  TextObject,
} from "./model";
import { sanitizeImageSrc } from "../sanitize";

export const DRAWING_FORMAT = "maca-drawing";
export const DRAWING_VERSION = "1.0";

export class DrawingError extends Error {}

/** `.draw.json` をパースする。 */
export function parseDrawingDocument(json: string): DrawingDocument {
  const value = JSON.parse(json) as DrawingDocument;
  return value;
}

/** Drawing Document を検証する。 */
export function validateDrawingDocument(doc: DrawingDocument): void {
  if (doc.format !== DRAWING_FORMAT) {
    throw new DrawingError(`format must be "${DRAWING_FORMAT}"`);
  }
  if (!doc.version || doc.version.length === 0) {
    throw new DrawingError("version is missing");
  }
  const { width, height, gridSize } = doc.canvas ?? {};
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isFinite(gridSize) ||
    gridSize <= 0
  ) {
    throw new DrawingError("canvas size is invalid");
  }
  if (!Array.isArray(doc.objects)) {
    throw new DrawingError("objects must be an array");
  }

  const ids = new Set<string>();
  for (const obj of doc.objects) {
    if (!obj.id || ids.has(obj.id)) {
      throw new DrawingError("object id must be unique");
    }
    ids.add(obj.id);
    if (!isKnownType(obj.type)) {
      throw new DrawingError(`unknown object type: ${obj.type}`);
    }
    validateNumeric(obj);
  }

  // Connector の参照先検証
  for (const obj of doc.objects) {
    if (obj.type === "connector") {
      const conn = obj as ConnectorObject;
      if (!ids.has(conn.from.objectId) || !ids.has(conn.to.objectId)) {
        throw new DrawingError("connector references missing object");
      }
    }
  }
}

function isKnownType(type: string): boolean {
  return [
    "rectangle",
    "roundedRectangle",
    "ellipse",
    "text",
    "line",
    "arrow",
    "image",
    "connector",
    "group",
  ].includes(type);
}

function validateNumeric(obj: DrawingObject): void {
  const fields: Array<keyof DrawingObject> = [
    "x",
    "y",
    "width",
    "height",
    "rotation",
    "zIndex",
  ];
  for (const key of fields) {
    const value = obj[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new DrawingError(`invalid numeric field: ${key}`);
    }
  }
  if (obj.type === "line" || obj.type === "arrow") {
    const line = obj as LineObject | ArrowObject;
    if (!Number.isFinite(line.x2) || !Number.isFinite(line.y2)) {
      throw new DrawingError("invalid line endpoint");
    }
  }
  if (obj.type === "image") {
    const img = obj as ImageObject;
    if (typeof img.src !== "string" || img.src.length === 0) {
      throw new DrawingError("image src is required");
    }
    if (sanitizeImageSrc(img.src) !== img.src) {
      throw new DrawingError("image src is invalid");
    }
  }
}

/** Drawing Document を検証付きでパースする。 */
export function parseAndValidate(json: string): DrawingDocument {
  const doc = parseDrawingDocument(json);
  validateDrawingDocument(doc);
  return doc;
}

/** Drawing Document を JSON 文字列へシリアライズする。 */
export function serializeDrawingDocument(doc: DrawingDocument): string {
  return JSON.stringify(doc, null, 2);
}

export type {
  ArrowObject,
  ConnectorObject,
  DrawingObject,
  EllipseObject,
  GroupObject,
  ImageObject,
  LineObject,
  RectangleObject,
  TextObject,
};
