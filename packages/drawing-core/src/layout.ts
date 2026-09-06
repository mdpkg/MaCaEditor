import type { DrawingDocument, DrawingObject } from "./model";
import { findObjectById, moveObject } from "./edit";

export type DistributionDirection = "horizontal" | "vertical";
export interface SmartGuide { axis: "x" | "y"; value: number; start: number; end: number }

/** Axis-aligned visual bounds, including rotation and reversed line endpoints. */
function bounds(object: DrawingObject) {
  if (object.type === "line" || object.type === "arrow") {
    return { x: Math.min(object.x, object.x2), y: Math.min(object.y, object.y2),
      width: Math.abs(object.x2 - object.x), height: Math.abs(object.y2 - object.y) };
  }
  const angle = object.rotation * Math.PI / 180;
  const width = Math.abs(object.width * Math.cos(angle)) + Math.abs(object.height * Math.sin(angle));
  const height = Math.abs(object.width * Math.sin(angle)) + Math.abs(object.height * Math.cos(angle));
  return { x: object.x + (object.width - width) / 2, y: object.y + (object.height - height) / 2, width, height };
}

function selectedRoots(objects: DrawingObject[], ids: Set<string>): DrawingObject[] {
  return objects.flatMap(object => ids.has(object.id)
    ? object.type === "connector" ? [] : [object]
    : object.type === "group" ? selectedRoots(object.members, ids) : []);
}

/** Equalize edge-to-edge gaps, retaining the first and last visual bounds. */
export function distributeObjects(doc: DrawingDocument, ids: string[], direction: DistributionDirection): DrawingDocument {
  const axis = direction === "horizontal" ? "x" : "y";
  const size = direction === "horizontal" ? "width" : "height";
  const targets = selectedRoots(doc.objects, new Set(ids)).map(object => ({ object, box: bounds(object) }))
    .sort((a, b) => a.box[axis] - b.box[axis]);
  if (targets.length < 3) return doc;
  const first = targets[0].box;
  const last = targets[targets.length - 1].box;
  const gap = (last[axis] + last[size] - first[axis] - targets.reduce((sum, t) => sum + t.box[size], 0)) / (targets.length - 1);
  let position = first[axis] + first[size] + gap;
  let result = doc;
  for (const target of targets.slice(1, -1)) {
    const delta = position - target.box[axis];
    result = moveObject(result, target.object.id, axis === "x" ? delta : 0, axis === "y" ? delta : 0);
    position += target.box[size] + gap;
  }
  return result;
}

/** Snap the selection as one unit. The caller supplies a zoom-adjusted tolerance. */
export function smartGuideMove(doc: DrawingDocument, ids: string[], delta: { x: number; y: number }, tolerance: number): {
  delta: { x: number; y: number }; guides: SmartGuide[];
} {
  const selected = new Set(ids);
  const moving = selectedRoots(doc.objects, selected).map(bounds);
  const result = { delta: { ...delta }, guides: [] as SmartGuide[] };
  if (!moving.length) return result;
  // Do not use a selected object's ancestors or descendants as stationary targets.
  const stationary = (objects: DrawingObject[]): DrawingObject[] => objects.flatMap(object => {
    if (selected.has(object.id) || object.type === "connector") return [];
    if (object.type === "group" && ids.some(id => findObjectById(object.members, id))) return stationary(object.members);
    return [object];
  });
  const candidates = stationary(doc.objects).map(bounds);
  const box = {
    x: Math.min(...moving.map(b => b.x)), y: Math.min(...moving.map(b => b.y)),
    right: Math.max(...moving.map(b => b.x + b.width)), bottom: Math.max(...moving.map(b => b.y + b.height)),
  };
  for (const axis of ["x", "y"] as const) {
    const size = axis === "x" ? "width" : "height";
    const far = axis === "x" ? box.right : box.bottom;
    const anchors = [box[axis], (box[axis] + far) / 2, far];
    let best: { distance: number; correction: number; value: number; target: ReturnType<typeof bounds> } | undefined;
    for (const target of candidates) {
      for (const value of [target[axis], target[axis] + target[size] / 2, target[axis] + target[size]]) {
        for (const anchor of anchors) {
          const correction = value - anchor - delta[axis];
          const distance = Math.abs(correction);
          if (distance <= tolerance && (!best || distance < best.distance)) best = { distance, correction, value, target };
        }
      }
    }
    if (best) {
      result.delta[axis] += best.correction;
      const cross = axis === "x" ? "y" : "x";
      const crossSize = axis === "x" ? "height" : "width";
      result.guides.push({ axis, value: best.value,
        start: Math.min(box[cross] + delta[cross], best.target[cross]),
        end: Math.max((axis === "x" ? box.bottom : box.right) + delta[cross], best.target[cross] + best.target[crossSize]),
      });
    }
  }
  return result;
}
