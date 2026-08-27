export type FileTreeIconKind = "markdown" | "image" | "diagram" | "other";

function manifestDiagramPaths(manifest: Record<string, unknown>): Set<string> {
  if (!Array.isArray(manifest.resources)) return new Set();
  return new Set(manifest.resources.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const resource = item as Record<string, unknown>;
    return [resource.source, resource.rendered].filter((path): path is string => typeof path === "string");
  }));
}

export function fileTreeIconKind(
  path: string,
  manifest: Record<string, unknown>,
): FileTreeIconKind {
  if (manifestDiagramPaths(manifest).has(path)) return "diagram";
  const lower = path.toLowerCase();
  if (/\.(?:md|markdown)$/.test(lower)) return "markdown";
  if (/\.(?:draw\.json|puml|mmd|tex|dot)$/.test(lower)) return "diagram";
  if (/\.(?:png|jpe?g|gif|webp|bmp|svg)$/.test(lower)) return "image";
  return "other";
}
