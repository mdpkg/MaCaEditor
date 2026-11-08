import type { EditCheckpoint, FileInfo } from "../types";
import type { DocumentState } from "./document";
import { createEditHistory, recordEdit, type EditHistory, type EditHistoryEntry } from "./editHistory";

type FileEntry = Extract<EditHistoryEntry, { kind: "files" }>;
type FileAtIndex = NonNullable<FileEntry["files"][number]["before"]>;
type StoredFile = { index: number; file: Omit<FileInfo, "base64">; attachment?: number };
type StoredEntry = Exclude<EditHistoryEntry, FileEntry> | Omit<FileEntry, "files"> & {
  files: Array<{ path: string; before?: StoredFile; after?: StoredFile }>;
};

interface StoredHistory {
  version: number;
  cursor: number;
  entries: StoredEntry[];
  fileOrder: string[];
  manifest: DocumentState["manifest"];
  directories?: string[];
  staleResources?: string[];
}

export function captureEditCheckpoint(state: DocumentState, history: EditHistory): EditCheckpoint {
  const attachments: string[] = [];
  const positions = new Map<string, number>();
  const storeFile = (value: FileAtIndex | undefined): StoredFile | undefined => {
    if (!value) return;
    const { base64, ...file } = value.file;
    if (base64 === null) return { index: value.index, file };
    let attachment = positions.get(base64);
    if (attachment === undefined) {
      attachment = attachments.length;
      positions.set(base64, attachment);
      attachments.push(base64);
    }
    return { index: value.index, file, attachment };
  };
  const stored: StoredHistory = {
    version: 1,
    cursor: history.cursor,
    entries: history.entries.map((entry) => entry.kind === "text" ? entry : {
      ...entry,
      files: entry.files.map(({ path, before, after }) => ({ path, before: storeFile(before), after: storeFile(after) })),
    }),
    fileOrder: state.files.map((file) => file.path),
    manifest: state.manifest,
    directories: state.directories,
    staleResources: state.staleResources,
  };
  // Pass the JSON as a string so Rust does not decode partial UTF-16 surrogate pairs in text patches.
  return { data: JSON.stringify(stored), attachments };
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function index(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function restoreEditCheckpoint(state: DocumentState, checkpoint: EditCheckpoint): { state: DocumentState; history: EditHistory } {
  const invalid = () => new Error("Invalid or unsupported saved edit history");
  const data = JSON.parse(checkpoint.data) as StoredHistory;
  if (data?.version !== 1 || !Array.isArray(data.entries) || !index(data.cursor) || data.cursor > data.entries.length ||
      !strings(data.fileOrder) || !strings(checkpoint.attachments) ||
      (data.directories !== undefined && !strings(data.directories)) ||
      (data.staleResources !== undefined && !strings(data.staleResources)) ||
      !data.manifest || typeof data.manifest !== "object" || Array.isArray(data.manifest)) throw invalid();
  const remaining = new Map(state.files.map((file) => [file.path, file]));
  const files = data.fileOrder.map((path) => {
    const file = remaining.get(path);
    if (!file) throw invalid();
    remaining.delete(path);
    return file;
  });
  if (state.origin.kind !== "folder" && remaining.size) throw invalid();
  const history = createEditHistory();
  const restoreFile = (stored: StoredFile | undefined, path: string): FileAtIndex | undefined => {
    if (stored === undefined) return;
    if (!stored?.file || stored.file.path !== path || !index(stored.index) || typeof stored.file.is_text !== "boolean" ||
        (stored.file.content !== null && typeof stored.file.content !== "string")) throw invalid();
    const id = stored.attachment;
    if (id !== undefined && (!index(id) || id >= checkpoint.attachments.length)) throw invalid();
    return { index: stored.index, file: { ...stored.file, base64: id === undefined ? null : checkpoint.attachments[id] } };
  };
  for (const entry of data.entries) {
    if (!entry || typeof entry.label !== "string") throw invalid();
    if (entry.kind === "text") {
      const { path, change } = entry;
      if (typeof path !== "string" || !change || !index(change.from) || !index(change.beforeLength) || !index(change.afterLength) ||
          typeof change.before !== "string" || typeof change.after !== "string" ||
          change.from + change.before.length > change.beforeLength || change.from + change.after.length > change.afterLength ||
          change.beforeLength - change.before.length !== change.afterLength - change.after.length) throw invalid();
      recordEdit(history, entry);
    } else if (entry.kind === "files" && Array.isArray(entry.files) && entry.before && entry.after) {
      recordEdit(history, { ...entry, files: entry.files.map((change) => {
        if (!change || typeof change.path !== "string" || (!change.before && !change.after)) throw invalid();
        return { path: change.path, before: restoreFile(change.before, change.path), after: restoreFile(change.after, change.path) };
      }) });
    } else throw invalid();
  }
  history.cursor = data.cursor;
  return {
    state: {
      ...state,
      files: [...files, ...remaining.values()],
      directories: data.directories,
      staleResources: data.staleResources,
      manifest: { ...data.manifest, version: state.manifest.version },
    },
    history,
  };
}
