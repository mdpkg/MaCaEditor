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
import { svgLineStyle } from "./lineStyle";

/** テキストを SVG に埋め込む前にエスケープする。 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** オブジェクトの中心座標を返す。 */
function center(obj: DrawingObject): { x: number; y: number } {
  return { x: obj.x + obj.width / 2, y: obj.y + obj.height / 2 };
}

interface ConnectionSite {
  point: { x: number; y: number };
  outward: { x: number; y: number };
}

/** 相手に最も近い接続サイトと、その辺から外へ向かう方向を返す。 */
function connectionSite(obj: DrawingObject, toward: { x: number; y: number }): ConnectionSite {
  const own = center(obj);
  const dx = toward.x - own.x;
  const dy = toward.y - own.y;
  if (dx === 0 && dy === 0) return { point: own, outward: { x: 1, y: 0 } };
  const rx = Math.max(obj.width / 2, 0.001);
  const ry = Math.max(obj.height / 2, 0.001);
  if (obj.type === "ellipse") {
    const scale = 1 / Math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2);
    const length = Math.hypot(dx, dy);
    return {
      point: { x: own.x + dx * scale, y: own.y + dy * scale },
      outward: { x: dx / length, y: dy / length },
    };
  }
  if (Math.abs(dx) >= Math.abs(dy)) {
    const direction = Math.sign(dx);
    return {
      point: { x: own.x + direction * rx, y: own.y },
      outward: { x: direction, y: 0 },
    };
  }
  const direction = Math.sign(dy);
  return {
    point: { x: own.x, y: own.y + direction * ry },
    outward: { x: 0, y: direction },
  };
}

function renderRectangle(obj: RectangleObject): string {
  const fill = obj.style.fill ?? "#ffffff";
  const rect = `<rect x="${obj.x}" y="${obj.y}" width="${obj.width}" height="${obj.height}" fill="${escapeXml(fill)}" ${svgLineStyle(obj.style)} />`;
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
  const fromObj = objects.find((o) => o.id === obj.from.objectId);
  const toObj = objects.find((o) => o.id === obj.to.objectId);
  if (!fromObj || !toObj) return "";
  const fromCenter = center(fromObj);
  const toCenter = center(toObj);
  const fromSite = connectionSite(fromObj, toCenter);
  const toSite = connectionSite(toObj, fromCenter);
  const from = fromSite.point;
  const to = toSite.point;
  if (obj.curve) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const handle = Math.min(120, Math.max(40, Math.max(Math.abs(dx), Math.abs(dy)) * 0.5));
    const c1 = {
      x: from.x + fromSite.outward.x * handle,
      y: from.y + fromSite.outward.y * handle,
    };
    const c2 = {
      x: to.x + toSite.outward.x * handle,
      y: to.y + toSite.outward.y * handle,
    };
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
export function renderSvg(doc: DrawingDocument): string {
  const { width, height } = doc.canvas;
  const sorted = [...doc.objects].sort((a, b) => a.zIndex - b.zIndex);

  const body = sorted
    .map((obj) => {
      switch (obj.type) {
        case "rectangle":
          return renderRectangle(obj);
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

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<defs>
<marker id="arrowhead" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
<polygon points="0 0, 10 3, 0 6" fill="#000000" />
</marker>
</defs>
${body}
</svg>`;
}
