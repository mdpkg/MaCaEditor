/** MaCa Editor Drawing Domain Model */

export interface CanvasConfig {
  width: number;
  height: number;
  gridSize: number;
  /** false when the user has explicitly chosen the exported SVG canvas size. */
  fitToContent?: boolean;
}

export type LineDashStyle =
  | "solid" | "squareDot" | "roundDot" | "dash" | "dashDot" | "dashDotDot"
  | "longDash" | "longDashDot" | "longDashDotDot" | "sysDash" | "sysDot" | "sysDashDot";

export interface ObjectStyle {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  dashStyle?: LineDashStyle;
}

export interface TextStyle {
  fontSize?: number;
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  align?: "left" | "center" | "right";
  color?: string;
}

export interface ShapeTextStyle {
  align?: "left" | "center" | "right";
  verticalAlign?: "top" | "middle" | "bottom";
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
  textStyle?: ShapeTextStyle;
}

export interface RoundedRectangleObject extends BaseObject {
  type: "roundedRectangle";
  cornerRadius: number;
  style: ObjectStyle;
  text?: string;
  textStyle?: ShapeTextStyle;
}

export interface EllipseObject extends BaseObject {
  type: "ellipse";
  style: ObjectStyle;
  text?: string;
  textStyle?: ShapeTextStyle;
}

export interface FileObject extends BaseObject {
  type: "file";
  style: ObjectStyle;
  text?: string;
  textStyle?: ShapeTextStyle;
}

export interface UserObject extends BaseObject {
  type: "user";
  style: ObjectStyle;
  text?: string;
  textStyle?: ShapeTextStyle;
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

export interface ImageObject extends BaseObject {
  type: "image";
  src: string;
  style: ObjectStyle;
}

export interface ConnectorObject extends BaseObject {
  type: "connector";
  from: { objectId: string };
  to: { objectId: string };
  /** true の場合は曲線コネクタとして描画する。 */
  curve?: boolean;
  /** true の場合は水平・垂直のカギ線コネクタとして描画する。 */
  elbow?: boolean;
  style: ObjectStyle;
}

export interface GroupObject extends BaseObject {
  type: "group";
  members: DrawingObject[];
  style: ObjectStyle;
}

export type DrawingObject =
  | RectangleObject
  | RoundedRectangleObject
  | EllipseObject
  | FileObject
  | UserObject
  | TextObject
  | LineObject
  | ArrowObject
  | ImageObject
  | ConnectorObject
  | GroupObject;

export interface DrawingDocument {
  format: string;
  version: string;
  canvas: CanvasConfig;
  objects: DrawingObject[];
}
