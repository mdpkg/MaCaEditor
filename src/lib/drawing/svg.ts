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
  RoundedRectangleObject,
  TextObject,
} from "./model";
import { svgLineStyle } from "./lineStyle";
import { connectorGeometry } from "./connector";

interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

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
    return contentBounds(object.members);
  }
  return {
    minX: Math.min(object.x, object.x + object.width),
    minY: Math.min(object.y, object.y + object.height),
    maxX: Math.max(object.x, object.x + object.width),
    maxY: Math.max(object.y, object.y + object.height),
  };
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

function renderRectangle(obj: RectangleObject): string {
  const fill = obj.style.fill ?? "#ffffff";
  const rect = `<rect x="${obj.x}" y="${obj.y}" width="${obj.width}" height="${obj.height}" fill="${escapeXml(fill)}" ${svgLineStyle(obj.style)} />`;
  if (!obj.text) return rect;
  const cx = obj.x + obj.width / 2;
  const cy = obj.y + obj.height / 2;
  return `${rect}<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif">${escapeXml(obj.text)}</text>`;
}

function renderRoundedRectangle(obj: RoundedRectangleObject): string {
  const fill = obj.style.fill ?? "#ffffff";
  const radius = Math.max(0, Math.min(obj.cornerRadius, obj.width / 2, obj.height / 2));
  const rect = `<rect x="${obj.x}" y="${obj.y}" width="${obj.width}" height="${obj.height}" rx="${radius}" ry="${radius}" fill="${escapeXml(fill)}" ${svgLineStyle(obj.style)} />`;
  if (!obj.text) return rect;
  const cx = obj.x + obj.width / 2;
  const cy = obj.y + obj.height / 2;
  return `${rect}<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif">${escapeXml(obj.text)}</text>`;
}

function renderEllipse(obj: EllipseObject): string {
  const fill = obj.style.fill ?? "#ffffff";
  const cx = obj.x + obj.width / 2;
  const cy = obj.y + obj.height / 2;
  const rx = obj.width / 2;
  const ry = obj.height / 2;
  const ellipse = `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${escapeXml(fill)}" ${svgLineStyle(obj.style)} />`;
  if (!obj.text) return ellipse;
  return `${ellipse}<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif">${escapeXml(obj.text)}</text>`;
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
  if (c1 && c2) {
    return `<path d="M ${from.x} ${from.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${to.x} ${to.y}" fill="none" ${svgLineStyle(obj.style)} marker-end="url(#arrowhead)" />`;
  }
  return `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" ${svgLineStyle(obj.style)} marker-end="url(#arrowhead)" />`;
}

/** グループを SVG の <g> として描画する。 */
function renderGroup(obj: GroupObject): string {
  const sorted = [...obj.members].sort((a, b) => a.zIndex - b.zIndex);
  const body = sorted
    .map((member) => {
      switch (member.type) {
        case "rectangle":
          return renderRectangle(member);
        case "roundedRectangle":
          return renderRoundedRectangle(member);
        case "ellipse":
          return renderEllipse(member);
        case "text":
          return renderText(member);
        case "image":
          return renderImage(member);
        case "line":
          return renderLine(member);
        case "arrow":
          return renderArrow(member);
        case "connector":
          return renderConnector(member, obj.members);
        default:
          return "";
      }
    })
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
    .map((obj) => {
      switch (obj.type) {
        case "rectangle":
          return renderRectangle(obj);
        case "roundedRectangle":
          return renderRoundedRectangle(obj);
        case "ellipse":
          return renderEllipse(obj);
        case "text":
          return renderText(obj);
        case "image":
          return renderImage(obj);
        case "line":
          return renderLine(obj);
        case "arrow":
          return renderArrow(obj);
        case "connector":
          return renderConnector(obj, doc.objects);
        case "group":
          return renderGroup(obj);
        default:
          return "";
      }
    })
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewX} ${viewY} ${width} ${height}">
<defs>
<marker id="arrowhead" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
<polygon points="0 0, 10 3, 0 6" fill="#000000" />
</marker>
</defs>
${body}
</svg>`;
}
