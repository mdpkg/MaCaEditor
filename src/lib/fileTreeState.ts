import type { DocumentOrigin } from "./document";

export function fileTreeStateKey(origin: DocumentOrigin | undefined): string | undefined {
  if (!origin || origin.kind === "untitled") return undefined;
  return `maca.fileTree.${origin.kind}:${origin.path}`;
}

export function loadCollapsedPaths(key: string): Set<string> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (Array.isArray(saved)) {
      return new Set(saved.filter((path): path is string => typeof path === "string" && path.length > 0));
    }
  } catch { /* Keep the tree usable without storage. */ }
  return new Set();
}

export function saveCollapsedPaths(key: string, paths: Set<string>): void {
  try {
    if (paths.size > 0) localStorage.setItem(key, JSON.stringify([...paths]));
    else localStorage.removeItem(key);
  } catch { /* The in-memory state remains available. */ }
}
