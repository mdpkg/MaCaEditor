import type { DocumentState } from "./document";

export interface DocumentHistoryEntry {
  state: DocumentState;
  label: string;
}

export interface DocumentHistory {
  present: DocumentState;
  undo: DocumentHistoryEntry[];
  redo: DocumentHistoryEntry[];
}

export function createDocumentHistory(present: DocumentState): DocumentHistory {
  return { present, undo: [], redo: [] };
}

export function applyDocumentOperation(history: DocumentHistory, next: DocumentState, label: string): DocumentHistory {
  return { present: next, undo: [...history.undo, { state: history.present, label }], redo: [] };
}

export function undoDocumentOperation(history: DocumentHistory): DocumentHistory {
  const entry = history.undo[history.undo.length - 1];
  if (!entry) return history;
  return {
    present: entry.state,
    undo: history.undo.slice(0, -1),
    redo: [...history.redo, { state: history.present, label: entry.label }],
  };
}

export function redoDocumentOperation(history: DocumentHistory): DocumentHistory {
  const entry = history.redo[history.redo.length - 1];
  if (!entry) return history;
  return {
    present: entry.state,
    undo: [...history.undo, { state: history.present, label: entry.label }],
    redo: history.redo.slice(0, -1),
  };
}
