import type { DocumentState } from "./document";
import type { EditCheckpoint } from "../types";
import { markSaved, toFolderSaveRequest, toSaveRequest } from "./document";
import { exportPackage, saveFolder, savePackage } from "./tauri";

export interface PersistenceCommands {
  savePackage: typeof savePackage;
  saveFolder: typeof saveFolder;
  exportPackage: typeof exportPackage;
}

const commands: PersistenceCommands = { savePackage, saveFolder, exportPackage };

export async function saveDocument(
  state: DocumentState,
  persistence: PersistenceCommands = commands,
  editHistory?: EditCheckpoint,
  onHistoryWarning?: (warning: string) => void,
): Promise<DocumentState> {
  if (state.origin.kind === "untitled") throw new Error("Document needs a destination");
  const history = editHistory ? { edit_history: editHistory } : {};
  const result = state.origin.kind === "folder"
    ? await persistence.saveFolder({ ...toFolderSaveRequest(state), ...history })
    : await persistence.savePackage({ ...toSaveRequest(state), ...history });
  if (result?.edit_history_warning) onHistoryWarning?.(result.edit_history_warning);
  return markSaved(state, result?.folder_revision);
}

/** Retain edits while advancing the baseline to the snapshot actually written. */
export function applySavedBaseline(current: DocumentState, saved: DocumentState): DocumentState {
  return {
    ...current,
    path: saved.path,
    origin: saved.origin,
    manifest: { ...current.manifest, version: saved.manifest.version },
    originalPaths: saved.originalPaths,
    folderSnapshot: saved.folderSnapshot,
    dirty: true,
  };
}

export async function exportFolderDocumentPackage(
  state: DocumentState,
  path: string,
  persistence: PersistenceCommands = commands,
): Promise<DocumentState> {
  if (state.origin.kind !== "folder") throw new Error("Document is not in Folder mode");
  await persistence.exportPackage({ ...toSaveRequest(state), path });
  return state;
}
