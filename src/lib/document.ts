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

export function addImage(
  state: DocumentState,
  fileName: string,
  base64: string,
): { state: DocumentState; path: string } {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const dot = safeName.lastIndexOf(".");
  const stem = dot > 0 ? safeName.slice(0, dot) : safeName;
  const extension = dot > 0 ? safeName.slice(dot) : "";
  const used = new Set(state.files.map((file) => file.path.toLowerCase()));
  let path = `images/${safeName}`;
  let suffix = 2;
  while (used.has(path.toLowerCase())) {
    path = `images/${stem}-${suffix}${extension}`;
    suffix += 1;
  }

  return {
    path,
    state: {
      ...state,
      dirty: true,
      files: [
        ...state.files,
        { path, is_text: false, content: null, base64 },
      ],
    },
  };
}

export function imageMediaType(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase();
  switch (extension) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "bmp":
      return "image/bmp";
    default:
      return "image/png";
  }
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
