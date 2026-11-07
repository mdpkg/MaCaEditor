import type { Root, Text } from "mdast";
import type { Processor } from "unified";
import type { Node, Parent, Point } from "unist";

const minimumCachedLength = 32_768;
const plainText = /^[\p{L}\p{M}\p{N}](?:[\p{L}\p{M}\p{N} 、。！？!?，,]*[\p{L}\p{M}\p{N}、。！？!?，,])?$/u;

interface Snapshot {
  source: string;
  tree: Root;
}

interface TextEdit {
  leaf: Text;
  value: string;
  end: number;
  line: number;
  delta: number;
}

function singleText(node: Parent): Text | undefined {
  const leaf = node.children[0];
  return node.children.length === 1 && leaf?.type === "text" ? leaf as Text : undefined;
}

function containsChange(node: Node, from: number, to: number): boolean {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start !== undefined && end !== undefined && start <= from && to <= end;
}

function findPlainLeaf(tree: Root, from: number, to: number): Text | undefined {
  const block = tree.children.find((node) => containsChange(node, from, to));
  if (block?.type === "paragraph") return singleText(block);
  if (block?.type !== "table") return undefined;
  const row = block.children.find((node) => containsChange(node, from, to));
  const cell = row?.children.find((node) => containsChange(node, from, to));
  return cell && singleText(cell);
}

function findEdit(snapshot: Snapshot, source: string): TextEdit | undefined {
  const before = snapshot.source;
  let from = 0;
  while (from < before.length && from < source.length && before[from] === source[from]) from++;
  let previousEnd = before.length;
  let nextEnd = source.length;
  while (previousEnd > from && nextEnd > from && before[previousEnd - 1] === source[nextEnd - 1]) {
    previousEnd--;
    nextEnd--;
  }
  const leaf = findPlainLeaf(snapshot.tree, from, previousEnd);
  const position = leaf?.position;
  const start = position?.start.offset;
  const end = position?.end.offset;
  if (!leaf || !position || start === undefined || end === undefined || from < start || previousEnd > end) return undefined;
  if (position.start.line !== position.end.line || before.slice(start, end) !== leaf.value || !plainText.test(leaf.value)) return undefined;
  const delta = source.length - before.length;
  const value = source.slice(start, end + delta);
  if (!plainText.test(value)) return undefined;
  const lineEnd = before.indexOf("\n", end);
  const lineStart = before.lastIndexOf("\n", start - 1) + 1;
  if (before.slice(lineStart, lineEnd < 0 ? undefined : lineEnd).includes("\t")) return undefined;
  return { leaf, value, end, line: position.end.line, delta };
}

function shiftPoint(original: Point, edit?: TextEdit): Point {
  if (!edit || original.offset === undefined || original.offset < edit.end) return { ...original };
  return {
    ...original,
    offset: original.offset + edit.delta,
    column: original.line === edit.line ? original.column + edit.delta : original.column,
  };
}

function copyTree<T extends Node>(node: T, edit?: TextEdit): T {
  const copy = { ...node };
  if (node.position) copy.position = { start: shiftPoint(node.position.start, edit), end: shiftPoint(node.position.end, edit) };
  if (node.data) copy.data = structuredClone(node.data);
  if ("children" in node) (copy as T & Parent).children = (node as T & Parent).children.map((child) => copyTree(child, edit));
  if (edit && (node as Node) === edit.leaf) (copy as T & Text).value = edit.value;
  return copy;
}

export class PreviewParseCache {
  private snapshot: Snapshot | undefined;

  parse(source: string, parseAll: () => Root): Root {
    if (source.length < minimumCachedLength) {
      this.snapshot = undefined;
      return parseAll();
    }
    if (this.snapshot?.source === source) return copyTree(this.snapshot.tree);
    if (this.snapshot) {
      const edit = findEdit(this.snapshot, source);
      if (edit) return copyTree(this.snapshot.tree, edit);
    }
    const tree = parseAll();
    // Later remark plugins can modify the tree. Keep the original parse intact.
    this.snapshot = { source, tree };
    return copyTree(tree);
  }
}

export function remarkReusePreviewParse(this: Processor, cache: PreviewParseCache): void {
  const parseAll = this.parser;
  if (parseAll) this.parser = (source, file) => cache.parse(source, () => parseAll(source, file) as Root);
}
