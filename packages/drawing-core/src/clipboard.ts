import type { DrawingDocument, DrawingObject } from "./model";

/** Framework-independent drawing clipboard operations. */

/** 選択中のオブジェクトをコピーする。 */
export function copyObjects(
  doc: DrawingDocument,
  ids: string[],
): DrawingObject[] {
  return doc.objects.filter((o) => ids.includes(o.id));
}

/** 新しい一意 ID を生成する。 */
export function newId(prefix: string, existing: Set<string>): string {
  let n = 1;
  let id = `${prefix}-${n}`;
  while (existing.has(id)) {
    n += 1;
    id = `${prefix}-${n}`;
  }
  return id;
}

/** コピーしたオブジェクトをペーストする。参照 ID を再マッピングする。 */
export function pasteObjects(
  doc: DrawingDocument,
  copied: DrawingObject[],
): DrawingDocument {
  const existingIds = new Set(doc.objects.map((o) => o.id));
  const idMap = new Map<string, string>();

  // 新しい ID を割り当てる
  for (const obj of copied) {
    const newIdStr = newId(obj.type, existingIds);
    existingIds.add(newIdStr);
    idMap.set(obj.id, newIdStr);
  }

  const pasted = copied.map((obj) => {
    const base = { ...obj, id: idMap.get(obj.id)! };
    const offset = 20;
    const moved = {
      ...base,
      x: base.x + offset,
      y: base.y + offset,
    };
    if (obj.type === "connector") {
      const conn = obj as DrawingObject & {
        from: { objectId: string };
        to: { objectId: string };
      };
      return {
        ...moved,
        from: { objectId: idMap.get(conn.from.objectId) ?? conn.from.objectId },
        to: { objectId: idMap.get(conn.to.objectId) ?? conn.to.objectId },
      };
    }
    return moved;
  });

  return {
    ...doc,
    objects: [...doc.objects, ...pasted],
  };
}
