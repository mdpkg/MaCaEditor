import { parse, stringify } from "yaml";

type MarkdownNode = {
  type: string;
  value?: string;
  depth?: number;
  children?: MarkdownNode[];
  data?: {
    hName?: string;
    hProperties?: Record<string, unknown>;
  };
};

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value) && value.every((item) => typeof item !== "object" || item === null)) {
    return value.map((item) => String(item ?? "")).join(", ");
  }
  if (typeof value === "object") return stringify(value).trim();
  return String(value);
}

function tableRow(key: string, value: unknown): MarkdownNode {
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

function frontmatterTable(value: string): MarkdownNode {
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
  return (tree: MarkdownNode) => {
    const children = tree.children ?? [];
    const frontmatterIndex = children.findIndex((child) => child.type === "yaml");
    if (frontmatterIndex >= 0) {
      children.splice(frontmatterIndex, 1, frontmatterTable(children[frontmatterIndex].value ?? ""));
    }
    if (showToc) {
      children.splice(frontmatterIndex >= 0 ? frontmatterIndex + 1 : 0, 0, {
        type: "heading",
        depth: 2,
        children: [{ type: "text", value: "目次" }],
      });
    }
  };
}
