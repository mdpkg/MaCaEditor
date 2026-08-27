import type { FileInfo } from "../types";
import { isMarkdownPath, resolvePackagePath } from "./markdown";
import { markdownLinks } from "./markdownLinks";

function internalDestination(destination: string): string | null {
  if (!destination || destination.startsWith("#") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(destination)) return null;
  const rawPath = destination.split(/[?#]/, 1)[0];
  if (!rawPath) return null;
  try { return decodeURIComponent(rawPath); } catch { return rawPath; }
}

export function resolveMarkdownLink(markdownPath: string, destination: string, files: FileInfo[]): string | null {
  const target = internalDestination(destination);
  if (!target) return null;
  const baseDir = markdownPath.includes("/") ? markdownPath.slice(0, markdownPath.lastIndexOf("/")) : "";
  const resolved = resolvePackagePath(baseDir, target);
  return resolved && files.some((file) => file.path === resolved) ? resolved : null;
}

export interface Backlink {
  path: string;
  line: number;
  offset: number;
}

export function findBacklinks(targetPath: string, files: FileInfo[]): Backlink[] {
  const backlinks: Backlink[] = [];
  for (const file of files) {
    if (!file.is_text || file.content === null || !isMarkdownPath(file.path)) continue;
    for (const link of markdownLinks(file.content)) {
      if (resolveMarkdownLink(file.path, link.destination, files) !== targetPath) continue;
      backlinks.push({
        path: file.path,
        line: file.content.slice(0, link.start).split("\n").length,
        offset: link.start,
      });
    }
  }
  return backlinks;
}
