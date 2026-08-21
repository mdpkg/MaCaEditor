import type {
  ArrowObject,
  ConnectorObject,
  DrawingDocument,
  DrawingObject,
  EllipseObject,
  FileObject,
  GroupObject,
  ImageObject,
  LineObject,
  RectangleObject,
  RoundedRectangleObject,
  TextObject,
  UserObject,
} from "./model";
import { svgLineStyle } from "./lineStyle";
import { connectorGeometry } from "./connector";

interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

function rotateBounds(bounds: Bounds, cx: number, cy: number, rotation: number): Bounds {
  if (!rotation) return bounds;
  const radians = rotation * Math.PI / 180;
  const rotate = (x: number, y: number) => ({
    x: cx + (x - cx) * Math.cos(radians) - (y - cy) * Math.sin(radians),
    y: cy + (x - cx) * Math.sin(radians) + (y - cy) * Math.cos(radians),
  });
  const points = [
    rotate(bounds.minX, bounds.minY),
    rotate(bounds.maxX, bounds.minY),
    rotate(bounds.maxX, bounds.maxY),
    rotate(bounds.minX, bounds.maxY),
  ];
  const clean = (value: number) => Number(value.toFixed(10));
  return {
    minX: clean(Math.min(...points.map((point) => point.x))),
    minY: clean(Math.min(...points.map((point) => point.y))),
    maxX: clean(Math.max(...points.map((point) => point.x))),
    maxY: clean(Math.max(...points.map((point) => point.y))),
  };
}

function objectBounds(object: DrawingObject): Bounds | null {
  if (object.type === "connector") return null;
  if (object.type === "line" || object.type === "arrow") {
    return {
      minX: Math.min(object.x, object.x2),
      minY: Math.min(object.y, object.y2),
      maxX: Math.max(object.x, object.x2),
      maxY: Math.max(object.y, object.y2),
    };
  }
  if (object.type === "group" && object.members.length > 0) {
    const bounds = contentBounds(object.members);
    return bounds
      ? rotateBounds(bounds, object.x + object.width / 2, object.y + object.height / 2, object.rotation)
      : null;
  }
  const bounds = {
    minX: Math.min(object.x, object.x + object.width),
    minY: Math.min(object.y, object.y + object.height),
    maxX: Math.max(object.x, object.x + object.width),
    maxY: Math.max(object.y, object.y + object.height),
  };
  return rotateBounds(
    bounds,
    object.x + object.width / 2,
    object.y + object.height / 2,
    object.rotation,
  );
}

function contentBounds(objects: DrawingObject[]): Bounds | null {
  const bounds = objects.map(objectBounds).filter((value): value is Bounds => value !== null);
  if (bounds.length === 0) return null;
  return {
    minX: Math.min(...bounds.map((value) => value.minX)),
    minY: Math.min(...bounds.map((value) => value.minY)),
    maxX: Math.max(...bounds.map((value) => value.maxX)),
    maxY: Math.max(...bounds.map((value) => value.maxY)),
  };
}

/** テキストを SVG に埋め込む前にエスケープする。 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type TextShape = RectangleObject | RoundedRectangleObject | EllipseObject | FileObject | UserObject;

function svgFillStyle(obj: TextShape): string {
  const fill = obj.style.fill ?? "#ffffff";
  const opacity = obj.style.fillOpacity === undefined
    ? ""
    : ` fill-opacity="${Math.max(0, Math.min(1, obj.style.fillOpacity))}"`;
  return `fill="${escapeXml(fill)}"${opacity}`;
}

function renderShapeText(obj: TextShape): string {
  if (!obj.text) return "";
  const padding = Math.min(8, obj.width / 2, obj.height / 2);
  const align = obj.textStyle?.align ?? "center";
  const verticalAlign = obj.textStyle?.verticalAlign ?? "middle";
  const x = align === "left"
    ? obj.x + padding
    : align === "right"
      ? obj.x + obj.width - padding
      : obj.x + obj.width / 2;
  const y = verticalAlign === "top"
    ? obj.y + padding
    : verticalAlign === "bottom"
      ? obj.y + obj.height - padding
      : obj.y + obj.height / 2;
  const anchor = align === "left" ? "start" : align === "right" ? "end" : "middle";
  const baseline = verticalAlign === "top" ? "hanging" : verticalAlign === "bottom" ? "auto" : "middle";
  const lines = obj.text.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length === 1) {
    return `<text x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="${baseline}" font-family="sans-serif">${escapeXml(obj.text)}</text>`;
  }
  const firstOffset = verticalAlign === "top"
    ? 0
    : verticalAlign === "bottom"
      ? -(lines.length - 1) * 1.2
      : -(lines.length - 1) * 0.6;
  const formatEm = (value: number) => Number(value.toFixed(4));
  const tspans = lines.map((line, index) => {
    const dy = index === 0 && firstOffset === 0 ? "0" : `${index === 0 ? formatEm(firstOffset) : 1.2}em`;
    return `<tspan x="${x}" dy="${dy}">${escapeXml(line)}</tspan>`;
  }).join("");
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="${baseline}" font-family="sans-serif">${tspans}</text>`;
}

function renderRectangle(obj: RectangleObject): string {
  const rect = `<rect x="${obj.x}" y="${obj.y}" width="${obj.width}" height="${obj.height}" ${svgFillStyle(obj)} ${svgLineStyle(obj.style)} />`;
  return `${rect}${renderShapeText(obj)}`;
}

function renderRoundedRectangle(obj: RoundedRectangleObject): string {
  const radius = Math.max(0, Math.min(obj.cornerRadius, obj.width / 2, obj.height / 2));
  const rect = `<rect x="${obj.x}" y="${obj.y}" width="${obj.width}" height="${obj.height}" rx="${radius}" ry="${radius}" ${svgFillStyle(obj)} ${svgLineStyle(obj.style)} />`;
  return `${rect}${renderShapeText(obj)}`;
}

function renderEllipse(obj: EllipseObject): string {
  const cx = obj.x + obj.width / 2;
  const cy = obj.y + obj.height / 2;
  const rx = obj.width / 2;
  const ry = obj.height / 2;
  const ellipse = `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" ${svgFillStyle(obj)} ${svgLineStyle(obj.style)} />`;
  return `${ellipse}${renderShapeText(obj)}`;
}

function renderFile(obj: FileObject): string {
  const fold = Math.min(24, obj.width * 0.25, obj.height * 0.3);
  const right = obj.x + obj.width;
  const bottom = obj.y + obj.height;
  const foldX = right - fold;
  const foldY = obj.y + fold;
  const page = `<path data-shape="file" d="M ${obj.x} ${obj.y} H ${foldX} L ${right} ${foldY} V ${bottom} H ${obj.x} Z" ${svgFillStyle(obj)} ${svgLineStyle(obj.style)} />`;
  const corner = `<polyline points="${foldX},${obj.y} ${foldX},${foldY} ${right},${foldY}" fill="none" ${svgLineStyle(obj.style)} />`;
  return `${page}${corner}${renderShapeText(obj)}`;
}

function renderUser(obj: UserObject): string {
  const rounded = (value: number) => Number(value.toFixed(4));
  const cx = rounded(obj.x + obj.width / 2);
  const radius = rounded(Math.min(obj.width, obj.height) * 0.18);
  const headY = rounded(obj.y + obj.height * 0.27);
  const shoulderY = rounded(obj.y + obj.height * 0.58);
  const left = rounded(obj.x + obj.width * 0.15);
  const right = rounded(obj.x + obj.width * 0.85);
  const bottom = rounded(obj.y + obj.height);
  const leftControlY = rounded(obj.y + obj.height * 0.75);
  const leftShoulderX = rounded(obj.x + obj.width * 0.27);
  const rightShoulderX = rounded(obj.x + obj.width * 0.73);
  const head = `<circle data-shape="user" cx="${cx}" cy="${headY}" r="${radius}" ${svgFillStyle(obj)} ${svgLineStyle(obj.style)} />`;
  const body = `<path d="M ${left} ${bottom} C ${left} ${leftControlY}, ${leftShoulderX} ${shoulderY}, ${cx} ${shoulderY} C ${rightShoulderX} ${shoulderY}, ${right} ${leftControlY}, ${right} ${bottom} Z" ${svgFillStyle(obj)} ${svgLineStyle(obj.style)} />`;
  return `${head}${body}${renderShapeText(obj)}`;
}

function renderImage(obj: ImageObject): string {
  if (!obj.src || obj.src.length === 0) return "";
  const x = obj.x;
  const y = obj.y;
  const width = obj.width;
  const height = obj.height;
  return `<image x="${x}" y="${y}" width="${width}" height="${height}" href="${escapeXml(obj.src)}" preserveAspectRatio="xMidYMid meet" />`;
}

function renderText(obj: TextObject): string {
  const fontSize = obj.style.fontSize ?? 16;
  const fontFamily = obj.style.fontFamily ?? "sans-serif";
  const color = obj.style.color ?? "#000000";
  const bold = obj.style.bold ? " font-weight=\"bold\"" : "";
  const italic = obj.style.italic ? " font-style=\"italic\"" : "";
  const align = obj.style.align ?? "left";
  const anchor =
    align === "center" ? "middle" : align === "right" ? "end" : "start";
  const x = align === "center" ? obj.x + obj.width / 2 : align === "right" ? obj.x + obj.width : obj.x;
  return `<text x="${x}" y="${obj.y}" font-size="${fontSize}" font-family="${escapeXml(fontFamily)}" fill="${escapeXml(color)}" text-anchor="${anchor}"${bold}${italic}>${escapeXml(obj.text)}</text>`;
}

function renderLine(obj: LineObject): string {
  return `<line x1="${obj.x}" y1="${obj.y}" x2="${obj.x2}" y2="${obj.y2}" ${svgLineStyle(obj.style)} />`;
}

function renderArrow(obj: ArrowObject): string {
  return `<line x1="${obj.x}" y1="${obj.y}" x2="${obj.x2}" y2="${obj.y2}" ${svgLineStyle(obj.style)} marker-end="url(#arrowhead)" />`;
}

function renderConnector(
  obj: ConnectorObject,
  objects: DrawingObject[],
): string {
  const geometry = connectorGeometry(obj, objects);
  if (!geometry) return "";
  const { from, to, c1, c2 } = geometry;
  const markerId = (marker: "none" | "arrow" | "crowFoot") =>
    marker === "arrow" ? "arrowhead" : marker === "crowFoot" ? "crow-foot" : null;
  const startMarker = markerId(obj.startMarker ?? "none");
  const endMarker = markerId(obj.endMarker ?? "arrow");
  const markers = `${startMarker ? ` marker-start="url(#${startMarker})"` : ""}${endMarker ? ` marker-end="url(#${endMarker})"` : ""}`;
  if (geometry.points) {
    const points = geometry.points.map((point) => `${point.x},${point.y}`).join(" ");
    return `<polyline points="${points}" fill="none" ${svgLineStyle(obj.style)}${markers} />`;
  }
  if (c1 && c2) {
    return `<path d="M ${from.x} ${from.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${to.x} ${to.y}" fill="none" ${svgLineStyle(obj.style)}${markers} />`;
  }
  return `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" ${svgLineStyle(obj.style)}${markers} />`;
}

function renderObject(object: DrawingObject, siblings: DrawingObject[]): string {
  let content = "";
  switch (object.type) {
    case "rectangle": content = renderRectangle(object); break;
    case "roundedRectangle": content = renderRoundedRectangle(object); break;
    case "ellipse": content = renderEllipse(object); break;
    case "file": content = renderFile(object); break;
    case "user": content = renderUser(object); break;
    case "text": content = renderText(object); break;
    case "image": content = renderImage(object); break;
    case "line": return renderLine(object);
    case "arrow": return renderArrow(object);
    case "connector": return renderConnector(object, siblings);
    case "group": content = renderGroup(object); break;
  }
  if (!object.rotation) return content;
  const cx = object.x + object.width / 2;
  const cy = object.y + object.height / 2;
  return `<g transform="rotate(${object.rotation} ${cx} ${cy})">${content}</g>`;
}

/** グループを SVG の <g> として描画する。 */
function renderGroup(obj: GroupObject): string {
  const sorted = [...obj.members].sort((a, b) => a.zIndex - b.zIndex);
  const body = sorted
    .map((member) => renderObject(member, obj.members))
    .join("\n");
  return `<g id="${obj.id}">\n${body}\n</g>`;
}

/** Drawing Document から静的 SVG を生成する。 */
export function renderSvg(
  doc: DrawingDocument,
  options: { fitToContent?: boolean; margin?: number } = {},
): string {
  let width = doc.canvas.width;
  let height = doc.canvas.height;
  let viewX = 0;
  let viewY = 0;
  if (options.fitToContent) {
    const bounds = contentBounds(doc.objects);
    if (bounds) {
      const margin = Math.max(0, options.margin ?? 20);
      viewX = bounds.minX - margin;
      viewY = bounds.minY - margin;
      width = bounds.maxX - bounds.minX + margin * 2;
      height = bounds.maxY - bounds.minY + margin * 2;
    }
  }
  const sorted = [...doc.objects].sort((a, b) => a.zIndex - b.zIndex);

  const body = sorted
    .map((object) => renderObject(object, doc.objects))
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewX} ${viewY} ${width} ${height}">
<defs>
<marker id="arrowhead" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto-start-reverse" markerUnits="strokeWidth">
<polygon points="0 0, 10 3, 0 6" fill="#000000" />
</marker>
<marker id="crow-foot" markerWidth="12" markerHeight="10" refX="9" refY="3" orient="auto-start-reverse" markerUnits="strokeWidth">
<polyline points="0,0 9,3 0,6" fill="none" stroke="#000000" />
<line x1="0" y1="3" x2="9" y2="3" stroke="#000000" />
</marker>
</defs>
${body}
</svg>`;
}
