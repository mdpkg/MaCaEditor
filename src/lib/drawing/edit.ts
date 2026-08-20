import type {
  DrawingDocument,
  DrawingObject,
  GroupObject,
} from "./model";
import { createImageObject, newId } from "./factory";

export type AlignKind = "left" | "center" | "right" | "top" | "middle" | "bottom";

/** 画像オブジェクトを挿入する。src はサニタイズされる。 */
export function insertImageObject(
  doc: DrawingDocument,
  x: number,
  y: number,
  src: string,
): DrawingDocument {
  const obj = createImageObject(doc, x, y, src);
  return { ...doc, objects: [...doc.objects, obj] };
}

/** 指定位置にある最前面のオブジェクトを返す。無ければ undefined。 */
export function selectObject(
  doc: DrawingDocument,
  x: number,
  y: number,
): DrawingObject | undefined {
  const hit = doc.objects
    .filter(
      (o) =>
        x >= o.x &&
        x <= o.x + o.width &&
        y >= o.y &&
        y <= o.y + o.height,
    )
    .sort((a, b) => a.zIndex - b.zIndex);
  return hit[hit.length - 1];
}

export function selectObjectsInRect(
  doc: DrawingDocument,
  start: { x: number; y: number },
  end: { x: number; y: number },
): string[] {
  const left = Math.min(start.x, end.x);
  const right = Math.max(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const bottom = Math.max(start.y, end.y);
  return doc.objects.filter((object) => {
    if (object.type === "connector") return false;
    const objectLeft = object.type === "line" || object.type === "arrow"
      ? Math.min(object.x, object.x2)
      : Math.min(object.x, object.x + object.width);
    const objectRight = object.type === "line" || object.type === "arrow"
      ? Math.max(object.x, object.x2)
      : Math.max(object.x, object.x + object.width);
    const objectTop = object.type === "line" || object.type === "arrow"
      ? Math.min(object.y, object.y2)
      : Math.min(object.y, object.y + object.height);
    const objectBottom = object.type === "line" || object.type === "arrow"
      ? Math.max(object.y, object.y2)
      : Math.max(object.y, object.y + object.height);
    return objectRight >= left && objectLeft <= right && objectBottom >= top && objectTop <= bottom;
  }).map((object) => object.id);
}

/** オブジェクトを移動する。 */
export function moveObject(
  doc: DrawingDocument,
  id: string,
  dx: number,
  dy: number,
): DrawingDocument {
  return {
    ...doc,
    objects: doc.objects.map((o) =>
      o.id === id ? translateObject(o, dx, dy) : o,
    ),
  };
}

function translateObject(object: DrawingObject, dx: number, dy: number): DrawingObject {
  if (object.type === "line" || object.type === "arrow") {
    return {
      ...object,
      x: object.x + dx,
      y: object.y + dy,
      x2: object.x2 + dx,
      y2: object.y2 + dy,
    };
  }
  return { ...object, x: object.x + dx, y: object.y + dy };
}

export function moveObjectsFromDragStart(
  original: DrawingDocument,
  ids: string[],
  start: { x: number; y: number },
  current: { x: number; y: number },
): DrawingDocument {
  const selected = new Set(ids);
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  return {
    ...original,
    objects: original.objects.map((object) =>
      selected.has(object.id) ? translateObject(object, dx, dy) : object,
    ),
  };
}

export function moveObjectsFromDragStartSnapped(
  original: DrawingDocument,
  ids: string[],
  anchorId: string,
  start: { x: number; y: number },
  current: { x: number; y: number },
  gridSize: number,
): DrawingDocument {
  const anchor = original.objects.find((object) => object.id === anchorId);
  if (!anchor || gridSize <= 0) return moveObjectsFromDragStart(original, ids, start, current);
  const rawDx = current.x - start.x;
  const rawDy = current.y - start.y;
  const snappedX = Math.round((anchor.x + rawDx) / gridSize) * gridSize;
  const snappedY = Math.round((anchor.y + rawDy) / gridSize) * gridSize;
  return moveObjectsFromDragStart(
    original,
    ids,
    start,
    { x: start.x + snappedX - anchor.x, y: start.y + snappedY - anchor.y },
  );
}

export function moveObjectFromDragStart(
  original: DrawingDocument,
  id: string,
  start: { x: number; y: number },
  current: { x: number; y: number },
): DrawingDocument {
  return moveObject(original, id, current.x - start.x, current.y - start.y);
}

export function moveObjectFromDragStartSnapped(
  original: DrawingDocument,
  id: string,
  start: { x: number; y: number },
  current: { x: number; y: number },
  gridSize: number,
): DrawingDocument {
  const object = original.objects.find((candidate) => candidate.id === id);
  if (!object || gridSize <= 0) return moveObjectFromDragStart(original, id, start, current);
  const x = Math.round((object.x + current.x - start.x) / gridSize) * gridSize;
  const y = Math.round((object.y + current.y - start.y) / gridSize) * gridSize;
  return {
    ...original,
    objects: original.objects.map((candidate) =>
      candidate.id === id ? { ...candidate, x, y } : candidate,
    ),
  };
}

/** オブジェクトをリサイズする。 */
export function resizeObject(
  doc: DrawingDocument,
  id: string,
  width: number,
  height: number,
): DrawingDocument {
  return {
    ...doc,
    objects: doc.objects.map((o) =>
      o.id === id ? { ...o, width, height } : o,
    ),
  };
}

export type ObjectResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export function resizeObjectFromDragStart(
  original: DrawingDocument,
  id: string,
  handle: ObjectResizeHandle,
  start: { x: number; y: number },
  current: { x: number; y: number },
  snap: boolean,
  minimumSize = 10,
): DrawingDocument {
  const object = original.objects.find((candidate) => candidate.id === id);
  if (!object) return original;
  const snapValue = (value: number) =>
    snap ? Math.round(value / original.canvas.gridSize) * original.canvas.gridSize : value;
  const left = object.x;
  const top = object.y;
  const right = object.x + object.width;
  const bottom = object.y + object.height;
  let x = left;
  let y = top;
  let width = object.width;
  let height = object.height;

  if (handle.includes("w")) {
    x = Math.min(right - minimumSize, snapValue(left + current.x - start.x));
    width = right - x;
  } else if (handle.includes("e")) {
    width = Math.max(minimumSize, snapValue(right + current.x - start.x) - left);
  }
  if (handle.includes("n")) {
    y = Math.min(bottom - minimumSize, snapValue(top + current.y - start.y));
    height = bottom - y;
  } else if (handle.includes("s")) {
    height = Math.max(minimumSize, snapValue(bottom + current.y - start.y) - top);
  }

  return {
    ...original,
    objects: original.objects.map((candidate) =>
      candidate.id === id ? { ...candidate, x, y, width, height } : candidate,
    ),
  };
}

export type CanvasResizeEdge = "width" | "height" | "both";

/** Resize the SVG canvas from its right, bottom, or bottom-right edge. */
export function resizeCanvasFromDrag(
  doc: DrawingDocument,
  edge: CanvasResizeEdge,
  deltaX: number,
  deltaY: number,
  snap: boolean,
  minimumSize = 100,
): DrawingDocument {
  const snapSize = (value: number) =>
    snap ? Math.round(value / doc.canvas.gridSize) * doc.canvas.gridSize : value;
  const width = edge === "height"
    ? doc.canvas.width
    : Math.max(minimumSize, snapSize(doc.canvas.width + deltaX));
  const height = edge === "width"
    ? doc.canvas.height
    : Math.max(minimumSize, snapSize(doc.canvas.height + deltaY));
  return {
    ...doc,
    canvas: { ...doc.canvas, width, height, fitToContent: false },
  };
}

export function updateShapeText(
  doc: DrawingDocument,
  id: string,
  text: string,
): DrawingDocument {
  return {
    ...doc,
    objects: doc.objects.map((object) =>
      object.id === id && ["rectangle", "roundedRectangle", "ellipse", "file", "user"].includes(object.type)
        ? { ...object, text }
        : object,
    ),
  };
}

export function updateShapeTextAlignment(
  doc: DrawingDocument,
  id: string,
  align: "left" | "center" | "right",
  verticalAlign: "top" | "middle" | "bottom",
): DrawingDocument {
  return {
    ...doc,
    objects: doc.objects.map((object) =>
      object.id === id && ["rectangle", "roundedRectangle", "ellipse", "file", "user"].includes(object.type)
        ? { ...object, textStyle: { align, verticalAlign } }
        : object,
    ),
  };
}

/** オブジェクトを削除する。削除対象を参照する Connector も削除する。 */
export function deleteObjects(
  doc: DrawingDocument,
  ids: string[],
): DrawingDocument {
  const idSet = new Set(ids);
  return {
    ...doc,
    objects: doc.objects.filter((o) => {
      if (idSet.has(o.id)) return false;
      if (o.type === "connector") {
        const conn = o as DrawingObject & {
          from: { objectId: string };
          to: { objectId: string };
        };
        if (idSet.has(conn.from.objectId) || idSet.has(conn.to.objectId)) {
          return false;
        }
      }
      return true;
    }),
  };
}

/** オブジェクトを最前面へ移動する。 */
export function bringToFront(
  doc: DrawingDocument,
  ids: string[],
): DrawingDocument {
  const maxZ = Math.max(...doc.objects.map((o) => o.zIndex));
  return {
    ...doc,
    objects: doc.objects.map((o) =>
      ids.includes(o.id) ? { ...o, zIndex: maxZ + 1 } : o,
    ),
  };
}

/** オブジェクトを最背面へ移動する。 */
export function sendToBack(
  doc: DrawingDocument,
  ids: string[],
): DrawingDocument {
  const minZ = Math.min(...doc.objects.map((o) => o.zIndex));
  return {
    ...doc,
    objects: doc.objects.map((o) =>
      ids.includes(o.id) ? { ...o, zIndex: minZ - 1 } : o,
    ),
  };
}

/** オブジェクトを一つ前面へ移動する。 */
export function bringForward(
  doc: DrawingDocument,
  ids: string[],
): DrawingDocument {
  return {
    ...doc,
    objects: doc.objects.map((o) =>
      ids.includes(o.id) ? { ...o, zIndex: o.zIndex + 1 } : o,
    ),
  };
}

/** オブジェクトを一つ背面へ移動する。 */
export function sendBackward(
  doc: DrawingDocument,
  ids: string[],
): DrawingDocument {
  return {
    ...doc,
    objects: doc.objects.map((o) =>
      ids.includes(o.id) ? { ...o, zIndex: o.zIndex - 1 } : o,
    ),
  };
}

/** 複数オブジェクトを整列する。 */
export function alignObjects(
  doc: DrawingDocument,
  ids: string[],
  kind: AlignKind,
): DrawingDocument {
  const targets = doc.objects.filter((o) => ids.includes(o.id));
  if (targets.length === 0) return doc;

  switch (kind) {
    case "left": {
      const value = Math.min(...targets.map((o) => o.x));
      return {
        ...doc,
        objects: doc.objects.map((o) =>
          ids.includes(o.id) ? { ...o, x: value } : o,
        ),
      };
    }
    case "right": {
      const value = Math.max(...targets.map((o) => o.x + o.width));
      return {
        ...doc,
        objects: doc.objects.map((o) =>
          ids.includes(o.id) ? { ...o, x: value - o.width } : o,
        ),
      };
    }
    case "center": {
      const value =
        targets.reduce((sum, o) => sum + (o.x + o.width / 2), 0) /
        targets.length;
      return {
        ...doc,
        objects: doc.objects.map((o) =>
          ids.includes(o.id) ? { ...o, x: value - o.width / 2 } : o,
        ),
      };
    }
    case "top": {
      const value = Math.min(...targets.map((o) => o.y));
      return {
        ...doc,
        objects: doc.objects.map((o) =>
          ids.includes(o.id) ? { ...o, y: value } : o,
        ),
      };
    }
    case "bottom": {
      const value = Math.max(...targets.map((o) => o.y + o.height));
      return {
        ...doc,
        objects: doc.objects.map((o) =>
          ids.includes(o.id) ? { ...o, y: value - o.height } : o,
        ),
      };
    }
    case "middle": {
      const value =
        targets.reduce((sum, o) => sum + (o.y + o.height / 2), 0) /
        targets.length;
      return {
        ...doc,
        objects: doc.objects.map((o) =>
          ids.includes(o.id) ? { ...o, y: value - o.height / 2 } : o,
        ),
      };
    }
  }
}

/** 指定したオブジェクトをグループ化する。 */
export function groupObjects(
  doc: DrawingDocument,
  ids: string[],
): DrawingDocument {
  if (ids.length === 0) return doc;
  const targets = doc.objects.filter((o) => ids.includes(o.id));
  if (targets.length === 0) return doc;

  const minX = Math.min(...targets.map((o) => o.x));
  const minY = Math.min(...targets.map((o) => o.y));
  const maxX = Math.max(...targets.map((o) => o.x + o.width));
  const maxY = Math.max(...targets.map((o) => o.y + o.height));

  const existing = new Set(doc.objects.map((o) => o.id));
  const id = newId("group", existing);
  const zIndex = Math.max(0, ...doc.objects.map((o) => o.zIndex)) + 1;

  const group: GroupObject = {
    id,
    type: "group",
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    rotation: 0,
    zIndex,
    members: targets,
    style: {},
  };

  const idSet = new Set(ids);
  return {
    ...doc,
    objects: [...doc.objects.filter((o) => !idSet.has(o.id)), group],
  };
}

/** グループを解除して、メンバーをドキュメントに戻す。 */
export function ungroupObjects(
  doc: DrawingDocument,
  groupId: string,
): DrawingDocument {
  const group = doc.objects.find((o) => o.id === groupId);
  if (!group || group.type !== "group") return doc;

  const members = (group as GroupObject).members;
  return {
    ...doc,
    objects: [
      ...doc.objects.filter((o) => o.id !== groupId),
      ...members,
    ],
  };
}

/** グループを選択する（メンバーを含むヒットテスト）。 */
export function selectGroup(
  doc: DrawingDocument,
  x: number,
  y: number,
): DrawingObject | undefined {
  const hit = doc.objects
    .filter((o) => {
      if (o.type === "group") {
        return o.members.some(
          (m) =>
            x >= m.x && x <= m.x + m.width && y >= m.y && y <= m.y + m.height,
        );
      }
      return (
        x >= o.x && x <= o.x + o.width && y >= o.y && y <= o.y + o.height
      );
    })
    .sort((a, b) => a.zIndex - b.zIndex);
  return hit[hit.length - 1];
}

/** 履歴エントリ。 */
export interface HistoryEntry {
  before: DrawingDocument;
  after: DrawingDocument;
}

export type History = HistoryEntry[];

/** 履歴を push する。 */
export function pushHistory(
  history: History,
  before: DrawingDocument,
  after: DrawingDocument,
): History {
  return [...history, { before, after }];
}

/** Undo を適用し、直前の状態を返す。 */
export function undo(history: History): {
  doc: DrawingDocument;
  history: History;
} {
  if (history.length === 0) return { doc: emptyDoc(), history };
  const entry = history[history.length - 1];
  return {
    doc: entry.before,
    history: history.slice(0, history.length - 1),
  };
}

/** Redo を適用し、次の状態を返す。 */
export function redo(history: History): {
  doc: DrawingDocument;
  history: History;
} {
  if (history.length === 0) return { doc: emptyDoc(), history };
  const entry = history[history.length - 1];
  return {
    doc: entry.after,
    history: history.slice(0, history.length - 1),
  };
}

function emptyDoc(): DrawingDocument {
  return {
    format: "maca-drawing",
    version: "1.0",
    canvas: { width: 1200, height: 800, gridSize: 10 },
    objects: [],
  };
}
