import type { ConnectorObject, DrawingObject } from "./model";

export interface Point { x: number; y: number }
interface ConnectionSite { point: Point; outward: Point }
export interface ConnectorGeometry { from: Point; to: Point; c1?: Point; c2?: Point; points?: Point[] }

function center(object: DrawingObject): Point {
  return { x: object.x + object.width / 2, y: object.y + object.height / 2 };
}

function connectionSite(object: DrawingObject, toward: Point): ConnectionSite {
  const own = center(object);
  const dx = toward.x - own.x;
  const dy = toward.y - own.y;
  if (dx === 0 && dy === 0) return { point: own, outward: { x: 1, y: 0 } };
  const rx = Math.max(object.width / 2, 0.001);
  const ry = Math.max(object.height / 2, 0.001);
  if (object.type === "ellipse") {
    const scale = 1 / Math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2);
    const length = Math.hypot(dx, dy);
    return {
      point: { x: own.x + dx * scale, y: own.y + dy * scale },
      outward: { x: dx / length, y: dy / length },
    };
  }
  if (Math.abs(dx) >= Math.abs(dy)) {
    const direction = Math.sign(dx);
    return { point: { x: own.x + direction * rx, y: own.y }, outward: { x: direction, y: 0 } };
  }
  const direction = Math.sign(dy);
  return { point: { x: own.x, y: own.y + direction * ry }, outward: { x: 0, y: direction } };
}

export function connectorGeometry(connector: ConnectorObject, objects: DrawingObject[]): ConnectorGeometry | null {
  const fromObject = objects.find((object) => object.id === connector.from.objectId);
  const toObject = objects.find((object) => object.id === connector.to.objectId);
  if (!fromObject || !toObject) return null;
  const fromSite = connectionSite(fromObject, center(toObject));
  const toSite = connectionSite(toObject, center(fromObject));
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
  const dx = geometry.to.x - geometry.from.x;
  const dy = geometry.to.y - geometry.from.y;
  const handle = Math.min(120, Math.max(40, Math.max(Math.abs(dx), Math.abs(dy)) * 0.5));
  return {
    ...geometry,
    c1: { x: geometry.from.x + fromSite.outward.x * handle, y: geometry.from.y + fromSite.outward.y * handle },
    c2: { x: geometry.to.x + toSite.outward.x * handle, y: geometry.to.y + toSite.outward.y * handle },
  };
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
