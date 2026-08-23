import type { DocumentState } from "./document";
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
): Promise<DocumentState> {
  if (state.origin.kind === "untitled") throw new Error("Document needs a destination");
  if (state.origin.kind === "folder") await persistence.saveFolder(toFolderSaveRequest(state));
  else await persistence.savePackage(toSaveRequest(state));
  return markSaved(state);
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
