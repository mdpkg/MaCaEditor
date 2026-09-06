import type { ConnectorAnchor, ConnectorObject, DrawingObject } from "./model";

/** Connector geometry primitives. */

export interface Point { x: number; y: number }
interface ConnectionSite { point: Point; outward: Point }
export interface ConnectorGeometry {
  from: Point;
  to: Point;
  c1?: Point;
  c2?: Point;
  curveHandle?: Point;
  points?: Point[];
}

function center(object: DrawingObject): Point {
  return { x: object.x + object.width / 2, y: object.y + object.height / 2 };
}

function findObject(objects: DrawingObject[], id: string): DrawingObject | undefined {
  for (const object of objects) {
    if (object.id === id) return object;
    if (object.type === "group") {
      const member = findObject(object.members, id);
      if (member) return member;
    }
  }
  return undefined;
}

function rotatePoint(point: Point, pivot: Point, degrees: number): Point {
  if (!degrees) return point;
  const radians = degrees * Math.PI / 180;
  const dx = point.x - pivot.x;
  const dy = point.y - pivot.y;
  return {
    x: pivot.x + dx * Math.cos(radians) - dy * Math.sin(radians),
    y: pivot.y + dx * Math.sin(radians) + dy * Math.cos(radians),
  };
}

function rotateVector(vector: Point, degrees: number): Point {
  if (!degrees) return vector;
  const radians = degrees * Math.PI / 180;
  return {
    x: vector.x * Math.cos(radians) - vector.y * Math.sin(radians),
    y: vector.x * Math.sin(radians) + vector.y * Math.cos(radians),
  };
}

function connectionSite(object: DrawingObject, toward: Point): ConnectionSite {
  const own = center(object);
  const localToward = rotatePoint(toward, own, -object.rotation);
  const dx = localToward.x - own.x;
  const dy = localToward.y - own.y;
  if (dx === 0 && dy === 0) return { point: own, outward: { x: 1, y: 0 } };
  const rx = Math.max(object.width / 2, 0.001);
  const ry = Math.max(object.height / 2, 0.001);
  let site: ConnectionSite;
  if (object.type === "ellipse") {
    const scale = 1 / Math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2);
    const length = Math.hypot(dx, dy);
    site = {
      point: { x: own.x + dx * scale, y: own.y + dy * scale },
      outward: { x: dx / length, y: dy / length },
    };
  } else if (Math.abs(dx) >= Math.abs(dy)) {
    const direction = Math.sign(dx);
    site = { point: { x: own.x + direction * rx, y: own.y }, outward: { x: direction, y: 0 } };
  } else {
    const direction = Math.sign(dy);
    site = { point: { x: own.x, y: own.y + direction * ry }, outward: { x: 0, y: direction } };
  }
  return {
    point: rotatePoint(site.point, own, object.rotation),
    outward: rotateVector(site.outward, object.rotation),
  };
}

function anchoredConnectionSite(object: DrawingObject, anchor: ConnectorAnchor): ConnectionSite {
  const own = center(object);
  const x = object.x + Math.max(0, Math.min(1, anchor.x)) * object.width;
  const y = object.y + Math.max(0, Math.min(1, anchor.y)) * object.height;
  let outward: Point;
  if (object.type === "ellipse") {
    const nx = (x - own.x) / Math.max(object.width / 2, 0.001);
    const ny = (y - own.y) / Math.max(object.height / 2, 0.001);
    const length = Math.max(Math.hypot(nx, ny), 0.001);
    outward = { x: nx / length, y: ny / length };
  } else {
    const distances = [anchor.x, 1 - anchor.x, anchor.y, 1 - anchor.y];
    const side = distances.indexOf(Math.min(...distances));
    outward = side === 0 ? { x: -1, y: 0 }
      : side === 1 ? { x: 1, y: 0 }
        : side === 2 ? { x: 0, y: -1 }
          : { x: 0, y: 1 };
  }
  return {
    point: rotatePoint({ x, y }, own, object.rotation),
    outward: rotateVector(outward, object.rotation),
  };
}

/** 任意のキャンバス座標を、シェイプ輪郭上の相対アンカーへ射影する。 */
export function connectorAnchorForPoint(object: DrawingObject, point: Point): ConnectorAnchor {
  const local = rotatePoint(point, center(object), -object.rotation);
  const width = Math.max(object.width, 0.001);
  const height = Math.max(object.height, 0.001);
  let x = (local.x - object.x) / width;
  let y = (local.y - object.y) / height;
  if (object.type === "ellipse") {
    const dx = x - 0.5;
    const dy = y - 0.5;
    const scale = 0.5 / Math.max(Math.hypot(dx, dy), 0.001);
    return { x: 0.5 + dx * scale, y: 0.5 + dy * scale };
  }
  const inside = x >= 0 && x <= 1 && y >= 0 && y <= 1;
  x = Math.max(0, Math.min(1, x));
  y = Math.max(0, Math.min(1, y));
  if (inside) {
    const distances = [x, 1 - x, y, 1 - y];
    const side = distances.indexOf(Math.min(...distances));
    if (side === 0) x = 0;
    else if (side === 1) x = 1;
    else if (side === 2) y = 0;
    else y = 1;
  }
  return { x, y };
}

export function connectorGeometry(connector: ConnectorObject, objects: DrawingObject[]): ConnectorGeometry | null {
  const fromObject = findObject(objects, connector.from.objectId);
  const toObject = findObject(objects, connector.to.objectId);
  if (!fromObject || !toObject) return null;
  const fromSite = connector.from.anchor
    ? anchoredConnectionSite(fromObject, connector.from.anchor)
    : connectionSite(fromObject, center(toObject));
  const toSite = connector.to.anchor
    ? anchoredConnectionSite(toObject, connector.to.anchor)
    : connectionSite(toObject, center(fromObject));
  const geometry: ConnectorGeometry = { from: fromSite.point, to: toSite.point };
  if (connector.elbow) {
    const fromHorizontal = fromSite.outward.x !== 0;
    const toHorizontal = toSite.outward.x !== 0;
    if (fromHorizontal && toHorizontal) {
      const middleX = (geometry.from.x + geometry.to.x) / 2;
      return {
        ...geometry,
        points: [geometry.from, { x: middleX, y: geometry.from.y }, { x: middleX, y: geometry.to.y }, geometry.to],
      };
    }
    if (!fromHorizontal && !toHorizontal) {
      const middleY = (geometry.from.y + geometry.to.y) / 2;
      return {
        ...geometry,
        points: [geometry.from, { x: geometry.from.x, y: middleY }, { x: geometry.to.x, y: middleY }, geometry.to],
      };
    }
    const corner = fromHorizontal
      ? { x: geometry.to.x, y: geometry.from.y }
      : { x: geometry.from.x, y: geometry.to.y };
    return { ...geometry, points: [geometry.from, corner, geometry.to] };
  }
  if (!connector.curve) return geometry;
  if (connector.curveOffset) {
    const midpoint = {
      x: (geometry.from.x + geometry.to.x) / 2,
      y: (geometry.from.y + geometry.to.y) / 2,
    };
    const curveHandle = {
      x: midpoint.x + connector.curveOffset.x,
      y: midpoint.y + connector.curveOffset.y,
    };
    // A quadratic curve passing through curveHandle at t=0.5, converted to cubic controls.
    const quadraticControl = {
      x: 2 * curveHandle.x - midpoint.x,
      y: 2 * curveHandle.y - midpoint.y,
    };
    return {
      ...geometry,
      c1: {
        x: geometry.from.x + 2 / 3 * (quadraticControl.x - geometry.from.x),
        y: geometry.from.y + 2 / 3 * (quadraticControl.y - geometry.from.y),
      },
      c2: {
        x: geometry.to.x + 2 / 3 * (quadraticControl.x - geometry.to.x),
        y: geometry.to.y + 2 / 3 * (quadraticControl.y - geometry.to.y),
      },
      curveHandle,
    };
  }
  const dx = geometry.to.x - geometry.from.x;
  const dy = geometry.to.y - geometry.from.y;
  const handle = Math.min(120, Math.max(40, Math.max(Math.abs(dx), Math.abs(dy)) * 0.5));
  const sourceDistance = Math.max(Math.hypot(dx, dy), 0.001);
  const towardSource = { x: -dx / sourceDistance, y: -dy / sourceDistance };
  const curved = {
    ...geometry,
    c1: { x: geometry.from.x + fromSite.outward.x * handle, y: geometry.from.y + fromSite.outward.y * handle },
    c2: { x: geometry.to.x + towardSource.x * handle, y: geometry.to.y + towardSource.y * handle },
  };
  return { ...curved, curveHandle: cubicPoint(curved, 0.5) };
}

function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function cubicPoint(geometry: ConnectorGeometry, t: number): Point {
  const c1 = geometry.c1!;
  const c2 = geometry.c2!;
  const u = 1 - t;
  return {
    x: u ** 3 * geometry.from.x + 3 * u ** 2 * t * c1.x + 3 * u * t ** 2 * c2.x + t ** 3 * geometry.to.x,
    y: u ** 3 * geometry.from.y + 3 * u ** 2 * t * c1.y + 3 * u * t ** 2 * c2.y + t ** 3 * geometry.to.y,
  };
}

/** Midpoint on the route (half of the traveled distance for elbow connectors). */
export function connectorLabelPoint(geometry: ConnectorGeometry): Point {
  if (geometry.points) {
    const lengths = geometry.points.slice(1).map((point, i) => Math.hypot(
      point.x - geometry.points![i].x, point.y - geometry.points![i].y,
    ));
    let remaining = lengths.reduce((sum, length) => sum + length, 0) / 2;
    for (let i = 0; i < lengths.length; i++) {
      if (lengths[i] === 0) continue;
      if (remaining <= lengths[i]) {
        const start = geometry.points[i];
        const end = geometry.points[i + 1];
        const t = remaining / lengths[i];
        return { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
      }
      remaining -= lengths[i];
    }
    return geometry.from;
  }
  if (geometry.c1 && geometry.c2) return cubicPoint(geometry, 0.5);
  return { x: (geometry.from.x + geometry.to.x) / 2, y: (geometry.from.y + geometry.to.y) / 2 };
}

/** Shared layout for SVG output, hit testing, and export bounds. */
export function connectorLabelLayout(label: string, geometry: ConnectorGeometry) {
  const point = connectorLabelPoint(geometry);
  const lines = label.replace(/\r\n?/g, "\n").split("\n");
  // One em per code point is a conservative estimate, including CJK glyphs.
  const width = Math.max(...lines.map(line => Array.from(line).length), 1) * 14 + 8;
  const height = lines.length * 18 + 4;
  return { point, lines, x: point.x - width / 2, y: point.y - height / 2, width, height };
}

export function isPointOnConnector(geometry: ConnectorGeometry, x: number, y: number, tolerance: number): boolean {
  const point = { x, y };
  if (geometry.points) {
    return geometry.points.slice(1).some((end, index) =>
      distanceToSegment(point, geometry.points![index], end) <= tolerance,
    );
  }
  if (!geometry.c1 || !geometry.c2) return distanceToSegment(point, geometry.from, geometry.to) <= tolerance;
  let previous = geometry.from;
  for (let step = 1; step <= 32; step += 1) {
    const current = cubicPoint(geometry, step / 32);
    if (distanceToSegment(point, previous, current) <= tolerance) return true;
    previous = current;
  }
  return false;
}
