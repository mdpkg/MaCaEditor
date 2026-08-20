import type { FileContent, FileInfo, PackageInfo } from "../types";
import { relativePackagePath, resolvePackagePath } from "./markdown";

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
  const safeName = fileName
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
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

function safeAssetName(name: string): string {
  const safe = name.trim().normalize("NFC").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
  if (safe === "" || safe === "." || safe === "..") throw new Error("A valid name is required");
  return safe;
}

function replaceMarkdownPaths(content: string, markdownPath: string, replacements: Map<string, string>): string {
  return content.replace(/(!?\[[^\]]*\]\()([^)]+)(\))/g, (match, start, target, end) => {
    const baseDir = markdownPath.includes("/") ? markdownPath.slice(0, markdownPath.lastIndexOf("/")) : "";
    const resolved = resolvePackagePath(baseDir, target);
    const replacement = resolved ? replacements.get(resolved) : undefined;
    return replacement ? `${start}${relativePackagePath(markdownPath, replacement)}${end}` : match;
  });
}

export function renameAsset(
  state: DocumentState,
  path: string,
  requestedName: string,
): { state: DocumentState; path: string } {
  const resource = Array.isArray(state.manifest.resources)
    ? state.manifest.resources.find((item) =>
        typeof item === "object" && item !== null &&
        ((item as { source?: string }).source === path || (item as { rendered?: string }).rendered === path)) as
        | { source: string; rendered: string; type: string }
        | undefined
    : undefined;
  const directory = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  const prefix = directory ? `${directory}/` : "";
  const replacements = new Map<string, string>();
  let selectedNewPath: string;

  if (resource?.type === "drawing") {
    const name = safeAssetName(requestedName.replace(/(?:\.draw\.json|\.svg)$/i, ""));
    replacements.set(resource.source, `${prefix}${name}.draw.json`);
    replacements.set(resource.rendered, `${prefix}${name}.svg`);
    selectedNewPath = replacements.get(path)!;
  } else {
    const extension = path.slice(path.lastIndexOf("/") + 1).match(/(\.[^.]+)$/)?.[1] ?? "";
    const name = safeAssetName(requestedName.replace(new RegExp(`${extension.replace(".", "\\.")}$`, "i"), ""));
    selectedNewPath = `${prefix}${name}${extension}`;
    replacements.set(path, selectedNewPath);
  }

  const oldPaths = new Set(replacements.keys());
  const occupied = new Set(state.files.filter((file) => !oldPaths.has(file.path)).map((file) => file.path.toLowerCase()));
  for (const nextPath of replacements.values()) {
    if (occupied.has(nextPath.toLowerCase())) throw new Error(`A file named "${nextPath}" already exists`);
  }

  const resources = Array.isArray(state.manifest.resources)
    ? state.manifest.resources.map((item) => {
        if (typeof item !== "object" || item === null) return item;
        const value = item as Record<string, unknown>;
        return {
          ...value,
          source: typeof value.source === "string" ? replacements.get(value.source) ?? value.source : value.source,
          rendered: typeof value.rendered === "string" ? replacements.get(value.rendered) ?? value.rendered : value.rendered,
        };
      })
    : state.manifest.resources;

  return {
    path: selectedNewPath,
    state: {
      ...state,
      dirty: true,
      manifest: { ...state.manifest, resources },
      files: state.files.map((file) => {
        const nextPath = replacements.get(file.path) ?? file.path;
        const content = file.is_text && file.content !== null && /\.(md|markdown)$/i.test(file.path)
          ? replaceMarkdownPaths(file.content, file.path, replacements)
          : file.content;
        return { ...file, path: nextPath, content };
      }),
    },
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
