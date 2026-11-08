import type { FileInfo } from "../types";
import type { DocumentState } from "./document";

export type HistoryDirection = "undo" | "redo";
export type TextEditGroup = object;
export interface EditHistoryFocus {
  path: string;
  mode: "drawing" | "plantuml" | "mermaid";
}

interface TextChange {
  from: number;
  before: string;
  after: string;
  beforeLength: number;
  afterLength: number;
}

interface FileAtIndex {
  file: FileInfo;
  index: number;
}

interface FileChange {
  path: string;
  before?: FileAtIndex;
  after?: FileAtIndex;
}

function metadata(state: DocumentState) {
  const { entrypoint, directories, staleResources, manifest } = state;
  const { version: _version, ...manifestFields } = manifest;
  return { entrypoint, directories, staleResources, manifest: manifestFields };
}

export type EditHistoryEntry =
  | { kind: "text"; label: string; path: string; change: TextChange; beforeStale: string[] | undefined; afterStale: string[] | undefined }
  | { kind: "files"; label: string; focus?: EditHistoryFocus; files: FileChange[]; before: ReturnType<typeof metadata>; after: ReturnType<typeof metadata> };

export interface EditHistory {
  entries: EditHistoryEntry[];
  cursor: number;
}

interface AttachmentPayload {
  base64: string;
  references: number;
}

const largeAttachmentBase64Length = 2 ** 20;
const attachmentIndexes = new WeakMap<EditHistory, Map<string, AttachmentPayload[]>>();

function attachmentKey(base64: string): string {
  const middle = Math.floor(base64.length / 2);
  return `${base64.length}:${base64.slice(0, 16)}:${base64.slice(middle, middle + 16)}:${base64.slice(-16)}`;
}

export function reuseAttachmentPayload(history: EditHistory, base64: string): string {
  const index = attachmentIndexes.get(history);
  if (!index || base64.length < largeAttachmentBase64Length) return base64;
  // Samples only select candidates. Exact equality keeps same-sized files with matching samples distinct.
  return index.get(attachmentKey(base64))?.find((candidate) => candidate.base64 === base64)?.base64 ?? base64;
}

function updateAttachmentReferences(history: EditHistory, entry: EditHistoryEntry, delta: 1 | -1) {
  if (entry.kind !== "files") return;
  let index = attachmentIndexes.get(history);
  for (const change of entry.files) {
    for (const file of [change.before?.file, change.after?.file]) {
      const base64 = file?.base64;
      if (!base64 || base64.length < largeAttachmentBase64Length) continue;
      if (!index) {
        if (delta < 0) return;
        index = new Map();
        attachmentIndexes.set(history, index);
      }
      const key = attachmentKey(base64);
      const bucket = index.get(key) ?? [];
      const position = bucket.findIndex((candidate) => candidate.base64 === base64);
      if (position < 0) {
        if (delta > 0) {
          bucket.push({ base64, references: 1 });
          index.set(key, bucket);
        }
      } else {
        const candidate = bucket[position];
        candidate.references += delta;
        if (candidate.references === 0) {
          bucket.splice(position, 1);
          if (bucket.length === 0) index.delete(key);
        }
      }
    }
  }
}

export function createEditHistory(): EditHistory {
  return { entries: [], cursor: 0 };
}

export function recordEdit(history: EditHistory, entry: EditHistoryEntry) {
  if (history.cursor < history.entries.length) {
    for (const discarded of history.entries.splice(history.cursor)) {
      updateAttachmentReferences(history, discarded, -1);
    }
  }
  updateAttachmentReferences(history, entry, 1);
  history.entries.push(entry);
  history.cursor++;
}

function sameFile(left: FileInfo | undefined, right: FileInfo | undefined) {
  return left === right || (!!left && !!right && left.path === right.path && left.is_text === right.is_text &&
    left.content === right.content && left.base64 === right.base64);
}

function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((value, index) => sameJson(value, right[index]));
  }
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) return false;
  const leftFields = Object.entries(left).filter(([, value]) => value !== undefined);
  const rightFields = right as Record<string, unknown>;
  return leftFields.length === Object.values(rightFields).filter((value) => value !== undefined).length &&
    leftFields.every(([key, value]) => Object.prototype.hasOwnProperty.call(rightFields, key) && sameJson(value, rightFields[key]));
}

export function sameSavedContent(current: DocumentState, saved: DocumentState): boolean {
  if (current.files.length !== saved.files.length || !sameJson(metadata(current).manifest, metadata(saved).manifest)) return false;
  if (current.files.every((file, index) => sameFile(file, saved.files[index]))) return true;
  const savedFiles = new Map(saved.files.map((file) => [file.path, file]));
  return current.files.every((file) => sameFile(file, savedFiles.get(file.path)));
}

function historySlice(source: string, from: number, to: number): string {
  const slice = source.slice(from, to);
  if (!slice || source.length < 4096 || slice.length * 4 >= source.length) return slice;
  // A small slice can otherwise keep an entire old document alive. Copy it without changing UTF-16 code units.
  return JSON.parse(JSON.stringify(slice)) as string;
}

export function textHistoryEntry(
  path: string, before: string, after: string, beforeStale: string[] | undefined, afterStale: string[] | undefined,
  label = path,
): EditHistoryEntry {
  let from = 0;
  while (from < Math.min(before.length, after.length) && before[from] === after[from]) from++;
  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (beforeEnd > from && afterEnd > from && before[beforeEnd - 1] === after[afterEnd - 1]) {
    beforeEnd--;
    afterEnd--;
  }
  return {
    kind: "text", label, path, beforeStale, afterStale,
    change: {
      from, before: historySlice(before, from, beforeEnd), after: historySlice(after, from, afterEnd),
      beforeLength: before.length, afterLength: after.length,
    },
  };
}

export function fileHistoryEntry(
  current: DocumentState, next: DocumentState, label: string, focus?: EditHistoryFocus,
): EditHistoryEntry | undefined {
  const beforeFiles = new Map(current.files.map((file, index) => [file.path, { file, index }]));
  const afterFiles = new Map(next.files.map((file, index) => [file.path, { file, index }]));
  const files: FileChange[] = [];
  for (const path of new Set([...beforeFiles.keys(), ...afterFiles.keys()])) {
    const before = beforeFiles.get(path);
    const after = afterFiles.get(path);
    if (!sameFile(before?.file, after?.file)) files.push({ path, before, after });
  }
  const before = metadata(current);
  const after = metadata(next);
  if (files.length === 0 && sameJson(before, after)) return;
  return { kind: "files", label, focus, files, before, after };
}

export function applyEditHistoryEntry(current: DocumentState, entry: EditHistoryEntry, direction: HistoryDirection): DocumentState {
  const undo = direction === "undo";
  const conflict = () => new Error("履歴が現在の文書と一致しません。");
  if (entry.kind === "text") {
    const { from, before, after, beforeLength, afterLength } = entry.change;
    const expected = undo ? after : before;
    const replacement = undo ? before : after;
    const index = current.files.findIndex((file) => file.path === entry.path);
    const file = current.files[index];
    if (!file?.is_text || file.content == null || file.content.length !== (undo ? afterLength : beforeLength) ||
        file.content.slice(from, from + expected.length) !== expected ||
        !sameJson(current.staleResources, undo ? entry.afterStale : entry.beforeStale)) throw conflict();
    const files = current.files.slice();
    files[index] = { ...file, content: file.content.slice(0, from) + replacement + file.content.slice(from + expected.length) };
    return { ...current, files, staleResources: undo ? entry.beforeStale : entry.afterStale };
  }

  const expected = undo ? entry.after : entry.before;
  const replacement = undo ? entry.before : entry.after;
  if (!sameJson(metadata(current), expected)) throw conflict();
  const currentFiles = new Map(current.files.map((file, index) => [file.path, { file, index }]));
  const affected = new Set<string>();
  const placed = new Map<number, FileInfo>();
  for (const change of entry.files) {
    const source = undo ? change.after : change.before;
    const target = undo ? change.before : change.after;
    const actual = currentFiles.get(change.path);
    if (actual?.index !== source?.index || !sameFile(actual?.file, source?.file)) throw conflict();
    affected.add(change.path);
    if (target) placed.set(target.index, target.file);
  }
  const remaining = current.files.filter((file) => !affected.has(file.path));
  const count = remaining.length + placed.size;
  if ([...placed.keys()].some((position) => position >= count)) throw conflict();
  let index = 0;
  const files = Array.from({ length: count }, (_, position) => placed.get(position) ?? remaining[index++]);
  return { ...current, ...replacement, files, manifest: { ...replacement.manifest, version: current.manifest.version } };
}
