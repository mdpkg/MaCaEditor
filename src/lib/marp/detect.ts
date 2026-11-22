import { isAlias, isMap, parseDocument, visit } from "yaml";
import { isMarkdownPath } from "../markdown";

/** Detection is derived from source; never changes the document or manifest. */
export function detectMarp(markdown: string, path = "document.md"): { marp: boolean; warning?: string } {
  if (!isMarkdownPath(path)) return { marp: false };
  const source = markdown.startsWith("\uFEFF") ? markdown.slice(1) : markdown;
  const lines = source.slice(0, 65_544).split(/\r?\n/);
  if (lines[0] !== "---") return { marp: false };
  const end = lines.findIndex((line, index) => index > 0 && (line === "---" || line === "..."));
  const warning = "frontmatter が不正、または上限（64 KiB・エイリアス不可）を超えています。";
  if (end < 0) return { marp: false, warning };
  const yaml = lines.slice(1, end).join("\n");
  if (yaml.length > 65_536 || new TextEncoder().encode(yaml).length > 65_536) return { marp: false, warning };
  try {
    const document = parseDocument(yaml, { schema: "core", uniqueKeys: true });
    let alias = false;
    visit(document, (_, node) => { if (isAlias(node)) alias = true; });
    if (document.errors.length || document.warnings.length || alias) return { marp: false, warning };
    return { marp: isMap(document.contents) && document.get("marp") === true };
  } catch {
    return { marp: false, warning };
  }
}
