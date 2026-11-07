import type { Blockquote, Paragraph, Root } from "mdast";
import { toc } from "mdast-util-toc";
import { parse, stringify } from "yaml";

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value) && value.every((item) => typeof item !== "object" || item === null)) {
    return value.map((item) => String(item ?? "")).join(", ");
  }
  if (typeof value === "object") return stringify(value).trim();
  return String(value);
}

function tableRow(key: string, value: unknown): Paragraph {
  return {
    type: "paragraph",
    data: { hName: "tr" },
    children: [
      {
        type: "strong",
        data: { hName: "th", hProperties: { scope: "row" } },
        children: [{ type: "text", value: key }],
      },
      {
        type: "emphasis",
        data: { hName: "td" },
        children: [{ type: "text", value: displayValue(value) }],
      },
    ],
  };
}

function frontmatterTable(value: string): Blockquote {
  let parsed: unknown;
  try {
    parsed = parse(value);
  } catch {
    parsed = { YAML: value };
  }
  const entries: Array<[string, unknown]> = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? Object.entries(parsed as Record<string, unknown>)
    : [["YAML", parsed]];
  return {
    type: "blockquote",
    data: { hName: "table", hProperties: { className: ["markdown-frontmatter"] } },
    children: [{
      type: "blockquote",
      data: { hName: "tbody" },
      children: entries.map(([key, entryValue]) => tableRow(key, entryValue)),
    }],
  };
}

export function remarkFrontmatterTable({ showToc = false }: { showToc?: boolean } = {}) {
  return (tree: Root) => {
    const { children } = tree;
    const frontmatterIndex = children.findIndex((child) => child.type === "yaml");
    const frontmatter = children[frontmatterIndex];
    if (frontmatter?.type === "yaml") {
      children.splice(frontmatterIndex, 1, frontmatterTable(frontmatter.value));
    }
    if (!showToc) return;

    const { map } = toc(tree);
    children.splice(frontmatterIndex + 1, 0, {
      type: "heading",
      depth: 2,
      children: [{ type: "text", value: "目次" }],
    }, ...(map ? [map] : []));
  };
}
