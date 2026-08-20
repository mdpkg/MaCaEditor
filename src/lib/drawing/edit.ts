import type { DrawingDocument, DrawingObject } from "./model";
import { createImageObject } from "./factory";

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
      o.id === id ? { ...o, x: o.x + dx, y: o.y + dy } : o,
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
