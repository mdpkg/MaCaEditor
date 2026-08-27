import { fromMarkdown } from "mdast-util-from-markdown";
import type { FileInfo } from "../types";
import { isMarkdownPath } from "./markdown";
import { markdownLinks } from "./markdownLinks";
import { findBacklinks } from "./packageNavigation";

export type PackageSearchKind = "all" | "filename" | "content" | "heading" | "link" | "backlink";

export interface PackageSearchResult {
  path: string;
  line: number;
  offset: number;
  preview: string;
  kind: Exclude<PackageSearchKind, "all">;
}

interface AstNode {
  type: string;
  children?: AstNode[];
  value?: string;
  position?: { start?: { offset?: number; line?: number } };
}

function headingText(node: AstNode): string {
  if (typeof node.value === "string") return node.value;
  return node.children?.map(headingText).join("") ?? "";
}

export function searchPackage(files: FileInfo[], query: string, kind: PackageSearchKind = "all"): PackageSearchResult[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  if (kind === "backlink") return findBacklinks(query.trim(), files).map((item) => ({
    ...item, preview: `References ${query.trim()}`, kind: "backlink" as const,
  }));
  const results: PackageSearchResult[] = [];
  for (const file of files) {
    if ((kind === "all" || kind === "filename") && file.path.toLocaleLowerCase().includes(needle)) {
      results.push({ path: file.path, line: 1, offset: 0, preview: file.path, kind: "filename" });
    }
    if (!file.is_text || file.content === null) continue;
    if (kind === "all" || kind === "content") {
      file.content.split("\n").forEach((line, index) => {
        const column = line.toLocaleLowerCase().indexOf(needle);
        if (column >= 0) {
          const offset = file.content!.split("\n").slice(0, index).reduce((sum, value) => sum + value.length + 1, 0) + column;
          results.push({ path: file.path, line: index + 1, offset, preview: line.trim(), kind: "content" });
        }
      });
    }
    if (!isMarkdownPath(file.path)) continue;
    if (kind === "all" || kind === "heading") {
      const visit = (node: AstNode) => {
        if (node.type === "heading") {
          const text = headingText(node);
          if (text.toLocaleLowerCase().includes(needle)) results.push({
            path: file.path, line: node.position?.start?.line ?? 1,
            offset: node.position?.start?.offset ?? 0, preview: text, kind: "heading",
          });
        }
        node.children?.forEach(visit);
      };
      visit(fromMarkdown(file.content) as AstNode);
    }
    if (kind === "all" || kind === "link") {
      for (const link of markdownLinks(file.content)) {
        if (!link.destination.toLocaleLowerCase().includes(needle)) continue;
        results.push({ path: file.path, line: file.content.slice(0, link.start).split("\n").length,
          offset: link.start, preview: link.destination, kind: "link" });
      }
    }
  }
  return results;
}
