import { fromMarkdown } from "mdast-util-from-markdown";

export interface ChachaRange { from: number; to: number }
export interface ChachaContext {
  text: { target: string; previous?: string; next?: string; heading?: string };
  anchor: ChachaRange;
  ranges: ChachaRange[];
  key: string;
}
interface Node {
  type: string;
  value?: string;
  children?: Node[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}
interface Block { text: string; range: ChachaRange }

// Preserve UTF-16 offsets while conservatively excluding even unclosed YAML.
function withoutFrontmatter(source: string): string {
  const opening = /^\uFEFF?---[ \t]*\r?\n/.exec(source);
  if (!opening) return source;
  const closing = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(source.slice(opening[0].length));
  const end = closing ? opening[0].length + closing.index + closing[0].length : source.length;
  return source.slice(0, end).replace(/[^\r\n]/g, " ") + source.slice(end);
}
function plain(node: Node): string {
  if (node.type === "text" || node.type === "inlineCode") return node.value ?? "";
  if (node.type === "break") return "\n";
  if (node.type === "image" || node.type === "imageReference" || node.type === "html") return "";
  return node.children?.map(plain).join("") ?? "";
}
function containsHtml(node: Node): boolean {
  return node.type === "html" || node.children?.some(containsHtml) === true;
}
function block(node: Node): Block | null {
  const from = node.position?.start.offset, to = node.position?.end.offset;
  const text = plain(node).trim();
  // Conservatively skip slash-bearing prose too: POSIX paths need not be
  // separated from Japanese text by whitespace. Link destinations are already removed.
  if (!text || from === undefined || to === undefined || containsHtml(node)
      || text.includes("/") || /[a-z]:\\|\\\\/i.test(text)) return null;
  return { text, range: { from, to } };
}

/** Only the supplied editor text is inspected; no document/filesystem access. */
export function extractChachaContext(source: string, editedPosition: number): ChachaContext | null {
  if (editedPosition < 0 || editedPosition > source.length) return null;
  const root = fromMarkdown(withoutFrontmatter(source)) as Node;
  const paragraphs: Block[] = [], headings: Block[] = [];
  const visit = (node: Node) => {
    if (["code", "html", "definition"].includes(node.type)) return;
    if (node.type === "paragraph" || node.type === "heading") {
      const value = block(node);
      if (value) (node.type === "paragraph" ? paragraphs : headings).push(value);
      return;
    }
    node.children?.forEach(visit);
  };
  visit(root);
  const index = paragraphs.findIndex(({ range }) => range.from <= editedPosition && editedPosition <= range.to);
  if (index < 0) return null;
  const target = paragraphs[index];
  let remaining = 2000 - Array.from(target.text).length;
  if (remaining < 0) return null;
  const text: ChachaContext["text"] = { target: target.text };
  const ranges = [target.range];
  const priorHeadings = headings.filter(({ range }) => range.to <= target.range.from);
  const heading = priorHeadings[priorHeadings.length - 1];
  const add = (key: "heading" | "previous" | "next", value?: Block) => {
    if (!value) return;
    const count = Array.from(value.text).length;
    if (count > remaining) return;
    remaining -= count; text[key] = value.text; ranges.push(value.range);
  };
  add("heading", heading); add("previous", paragraphs[index - 1]); add("next", paragraphs[index + 1]);
  return { text, anchor: target.range, ranges, key: JSON.stringify(text) };
}
