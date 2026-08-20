/** MaCa Editor Drawing Domain Model */

export interface CanvasConfig {
  width: number;
  height: number;
  gridSize: number;
}

export interface ObjectStyle {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

export interface TextStyle {
  fontSize?: number;
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  align?: "left" | "center" | "right";
  color?: string;
}

export interface BaseObject {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
}

export interface RectangleObject extends BaseObject {
  type: "rectangle";
  style: ObjectStyle;
  text?: string;
}

export interface EllipseObject extends BaseObject {
  type: "ellipse";
  style: ObjectStyle;
  text?: string;
}

export interface TextObject extends BaseObject {
  type: "text";
  text: string;
  style: TextStyle;
}

export interface LineObject extends BaseObject {
  type: "line";
  x2: number;
  y2: number;
  style: ObjectStyle;
}

export interface ArrowObject extends BaseObject {
  type: "arrow";
  x2: number;
  y2: number;
  style: ObjectStyle;
}

export interface ConnectorObject extends BaseObject {
  type: "connector";
  from: { objectId: string };
  to: { objectId: string };
  style: ObjectStyle;
}

export type DrawingObject =
  | RectangleObject
  | EllipseObject
  | TextObject
  | LineObject
  | ArrowObject
  | ConnectorObject;

export interface DrawingDocument {
  format: string;
  version: string;
  canvas: CanvasConfig;
  objects: DrawingObject[];
}
