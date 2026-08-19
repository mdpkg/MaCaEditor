import type { FileContent, FileInfo, PackageInfo } from "../types";

export interface DocumentState {
  path: string | null;
  entrypoint: string;
  files: FileInfo[];
  manifest: Record<string, unknown>;
  dirty: boolean;
}

export function createDocumentState(info: PackageInfo, path: string): DocumentState {
  return {
    path,
    entrypoint: info.entrypoint,
    files: info.files,
    manifest: info.manifest,
    dirty: false,
  };
}

export function updateFileContent(
  state: DocumentState,
  filePath: string,
  content: string,
): DocumentState {
  return {
    ...state,
    dirty: true,
    files: state.files.map((f) =>
      f.path === filePath ? { ...f, content } : f,
    ),
  };
}

export function toSaveRequest(state: DocumentState): {
  path: string;
  manifest: Record<string, unknown>;
  files: FileContent[];
} {
  return {
    path: state.path ?? "",
    manifest: state.manifest,
    files: state.files.map((f) => ({
      path: f.path,
      is_text: f.is_text,
      content: f.content,
      base64: f.base64,
    })),
  };
}
