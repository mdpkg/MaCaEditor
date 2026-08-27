import { fromMarkdown } from "mdast-util-from-markdown";

export interface MarkdownLink {
  destination: string;
  image: boolean;
  kind: "inline" | "definition";
  start: number;
  end: number;
}

interface AstNode {
  type: string;
  url?: string;
  children?: AstNode[];
  position?: { start?: { offset?: number }; end?: { offset?: number } };
}

function destinationRange(source: string, node: AstNode): { start: number; end: number } | null {
  const nodeStart = node.position?.start?.offset;
  const nodeEnd = node.position?.end?.offset;
  if (nodeStart === undefined || nodeEnd === undefined) return null;
  const raw = source.slice(nodeStart, nodeEnd);
  let cursor: number;
  if (node.type === "definition") {
    const colon = raw.indexOf(":");
    if (colon < 0) return null;
    cursor = colon + 1;
  } else {
    const opener = raw.lastIndexOf("](");
    if (opener < 0) return null;
    cursor = opener + 2;
  }
  while (/\s/.test(raw[cursor] ?? "")) cursor += 1;
  if (raw[cursor] === "<") {
    const closing = raw.indexOf(">", cursor + 1);
    return closing < 0 ? null : { start: nodeStart + cursor + 1, end: nodeStart + closing };
  }
  const start = cursor;
  let depth = 0;
  let escaped = false;
  while (cursor < raw.length) {
    const character = raw[cursor];
    if (escaped) { escaped = false; cursor += 1; continue; }
    if (character === "\\") { escaped = true; cursor += 1; continue; }
    if (character === "(") depth += 1;
    if (character === ")") {
      if (depth === 0) break;
      depth -= 1;
    }
    if (/\s/.test(character) && depth === 0) break;
    cursor += 1;
  }
  return cursor === start ? null : { start: nodeStart + start, end: nodeStart + cursor };
}

export function markdownLinks(source: string): MarkdownLink[] {
  const root = fromMarkdown(source) as AstNode;
  const links: MarkdownLink[] = [];
  const visit = (node: AstNode) => {
    if ((node.type === "link" || node.type === "image" || node.type === "definition") && node.url !== undefined) {
      const range = destinationRange(source, node);
      if (range) links.push({
        destination: node.url,
        image: node.type === "image",
        kind: node.type === "definition" ? "definition" : "inline",
        ...range,
      });
    }
    node.children?.forEach(visit);
  };
  visit(root);
  return links.sort((left, right) => left.start - right.start);
}

export function rewriteMarkdownLinkDestinations(
  source: string,
  replacementFor: (destination: string, link: MarkdownLink) => string | null,
): string {
  const replacements = markdownLinks(source).flatMap((link) => {
    const replacement = replacementFor(link.destination, link);
    return replacement === null || replacement === link.destination ? [] : [{ ...link, replacement }];
  });
  return replacements.reduceRight(
    (result, replacement) => result.slice(0, replacement.start) + replacement.replacement + result.slice(replacement.end),
    source,
  );
}

export function markdownLinkAtPosition(source: string, position: number): MarkdownLink | null {
  return markdownLinks(source).find((link) => position >= link.start && position <= link.end) ?? null;
}
