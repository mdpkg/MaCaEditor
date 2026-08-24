export interface DiagramEditSnapshot { path: string; source: string }
export type DiagramEditApplyResult =
  | { ok: true; source: string }
  | { ok: false; reason: "stale-source" | "stale-diagram" | "empty-result" };

export function applyDiagramEdit(
  currentPath: string,
  currentSource: string,
  snapshot: DiagramEditSnapshot,
  updatedSource: string,
): DiagramEditApplyResult {
  if (currentPath !== snapshot.path) return { ok: false, reason: "stale-diagram" };
  if (currentSource !== snapshot.source) return { ok: false, reason: "stale-source" };
  if (!updatedSource.trim()) return { ok: false, reason: "empty-result" };
  return { ok: true, source: updatedSource };
}
