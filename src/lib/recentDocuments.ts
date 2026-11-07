export interface RecentDocument {
  path: string;
  kind: "package" | "folder";
}

const storageKey = "maca.recentDocuments";

export function loadRecentDocuments(): RecentDocument[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    return Array.isArray(saved) ? saved.filter((item): item is RecentDocument =>
      typeof item?.path === "string" && item.path.length > 0 &&
      (item.kind === "package" || item.kind === "folder")).slice(0, 8) : [];
  } catch { return []; }
}

export function saveRecentDocuments(documents: RecentDocument[]) {
  try { localStorage.setItem(storageKey, JSON.stringify(documents)); } catch { /* Editing remains available without storage. */ }
}
