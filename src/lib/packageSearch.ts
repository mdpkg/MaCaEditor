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
  length: number;
  preview: string;
  kind: Exclude<PackageSearchKind, "all">;
}

function context(lines: string[], line: number): string {
  return lines.slice(Math.max(0, line - 2), line + 1).join("\n");
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
  if (kind === "backlink") {
    const byPath = new Map(files.map((file) => [file.path, file.content?.split("\n") ?? []]));
    return findBacklinks(query.trim(), files).map((item) => ({
      ...item, length: query.trim().length, preview: context(byPath.get(item.path) ?? [], item.line), kind: "backlink" as const,
    }));
  }
  const results: PackageSearchResult[] = [];
  for (const file of files) {
    if ((kind === "all" || kind === "filename") && file.path.toLocaleLowerCase().includes(needle)) {
      results.push({ path: file.path, line: 1, offset: 0, length: 0, preview: file.path, kind: "filename" });
    }
    if (!file.is_text || file.content === null) continue;
    const content = file.content;
    const lines = content.split("\n");
    if (kind === "all" || kind === "content") {
      let lineOffset = 0;
      lines.forEach((line, index) => {
        const column = line.toLocaleLowerCase().indexOf(needle);
        if (column >= 0) results.push({
          path: file.path, line: index + 1, offset: lineOffset + column, length: query.trim().length,
          preview: context(lines, index + 1), kind: "content",
        });
        lineOffset += line.length + 1;
      });
    }
    if (!isMarkdownPath(file.path)) continue;
    if (kind === "all" || kind === "heading") {
      const visit = (node: AstNode) => {
        if (node.type === "heading") {
          const text = headingText(node);
          if (text.toLocaleLowerCase().includes(needle)) results.push({
            path: file.path, line: node.position?.start?.line ?? 1,
            offset: node.position?.start?.offset ?? 0, length: lines[(node.position?.start?.line ?? 1) - 1]?.length ?? 0,
            preview: context(lines, node.position?.start?.line ?? 1), kind: "heading",
          });
        }
        node.children?.forEach(visit);
      };
      visit(fromMarkdown(content) as AstNode);
    }
    if (kind === "all" || kind === "link") {
      for (const link of markdownLinks(content)) {
        if (!link.destination.toLocaleLowerCase().includes(needle)) continue;
        const line = content.slice(0, link.start).split("\n").length;
        results.push({ path: file.path, line, offset: link.start, length: link.end - link.start, preview: context(lines, line), kind: "link" });
      }
    }
  }
  return results;
}
