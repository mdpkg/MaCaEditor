import type { FileContent, FileInfo, FolderSaveRequest, PackageInfo } from "../types";

export type DocumentOrigin =
  | { kind: "package"; path: string }
  | { kind: "folder"; path: string }
  | { kind: "untitled" };
import { relativePackagePath, resolvePackagePath } from "./markdown";
import { folderDocumentFingerprint, folderInfoFingerprint } from "./folderSync";

export interface DocumentState {
  path: string | null;
  origin: DocumentOrigin;
  originalPaths: string[];
  entrypoint: string;
  files: FileInfo[];
  manifest: Record<string, unknown>;
  dirty: boolean;
  folderSnapshot?: string;
}

export function createDocumentState(info: PackageInfo, origin: DocumentOrigin | string): DocumentState {
  const resolvedOrigin = typeof origin === "string" ? { kind: "package" as const, path: origin } : origin;
  return {
    path: resolvedOrigin.kind === "untitled" ? null : resolvedOrigin.path,
    origin: resolvedOrigin,
    originalPaths: info.files.map((file) => file.path),
    entrypoint: info.entrypoint,
    files: info.files,
    manifest: info.manifest,
    dirty: false,
  };
}

export function createFolderDocumentState(info: PackageInfo, path: string): DocumentState {
  return { ...createDocumentState(info, { kind: "folder", path }), folderSnapshot: folderInfoFingerprint(info) };
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
  return addBinaryAsset(state, "images", fileName, base64);
}

export function addAttachment(
  state: DocumentState,
  fileName: string,
  base64: string,
): { state: DocumentState; path: string } {
  return addBinaryAsset(state, "attachments", fileName, base64);
}

function addBinaryAsset(
  state: DocumentState,
  directory: "images" | "attachments",
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
  let path = `${directory}/${safeName}`;
  let suffix = 2;
  while (used.has(path.toLowerCase())) {
    path = `${directory}/${stem}-${suffix}${extension}`;
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

function markdownDestination(target: string): string {
  const trimmed = target.trim();
  return trimmed.startsWith("<") && trimmed.endsWith(">")
    ? trimmed.slice(1, -1)
    : trimmed;
}

function formattedMarkdownDestination(path: string): string {
  return /[\s()]/.test(path) ? `<${path}>` : path;
}

function replaceMarkdownPaths(content: string, markdownPath: string, replacements: Map<string, string>): string {
  return content.replace(/(!?\[[^\]]*\]\()(<[^>]*>|[^)]+)(\))/g, (match, start, target, end) => {
    const baseDir = markdownPath.includes("/") ? markdownPath.slice(0, markdownPath.lastIndexOf("/")) : "";
    const resolved = resolvePackagePath(baseDir, markdownDestination(target));
    const replacement = resolved ? replacements.get(resolved) : undefined;
    return replacement
      ? `${start}${formattedMarkdownDestination(relativePackagePath(markdownPath, replacement))}${end}`
      : match;
  });
}

function diagramResourceForPath(state: DocumentState, path: string) {
  if (!Array.isArray(state.manifest.resources)) return undefined;
  return state.manifest.resources.find((item) =>
    typeof item === "object" &&
    item !== null &&
    ["drawing", "plantuml", "mermaid", "mathjax"].includes((item as { type?: string }).type ?? "") &&
    ((item as { source?: string }).source === path ||
      (item as { rendered?: string }).rendered === path),
  ) as { source: string; rendered: string; type: string } | undefined;
}

export function isDeletableAsset(state: DocumentState, path: string | null): boolean {
  if (!path) return false;
  return diagramResourceForPath(state, path) !== undefined ||
    /^images\/[^/]+\.(png|jpe?g|gif|webp|bmp)$/i.test(path) ||
    /^attachments\/[^/]+$/i.test(path);
}

function removeMarkdownAssetReferences(
  content: string,
  markdownPath: string,
  deletedPaths: Set<string>,
): string {
  return content.replace(/!?\[[^\]]*\]\((<[^>]*>|[^)]+)\)/g, (match, target: string) => {
    const baseDir = markdownPath.includes("/")
      ? markdownPath.slice(0, markdownPath.lastIndexOf("/"))
      : "";
    const resolved = resolvePackagePath(baseDir, markdownDestination(target));
    return resolved && deletedPaths.has(resolved) ? "" : match;
  });
}

export function deleteAsset(state: DocumentState, path: string): DocumentState {
  const drawing = diagramResourceForPath(state, path);
  const deletedPaths = new Set<string>();
  if (drawing) {
    deletedPaths.add(drawing.source);
    deletedPaths.add(drawing.rendered);
  } else if (
    /^images\/[^/]+\.(png|jpe?g|gif|webp|bmp)$/i.test(path) ||
    /^attachments\/[^/]+$/i.test(path)
  ) {
    deletedPaths.add(path);
  } else {
    throw new Error(`Asset cannot be deleted: ${path}`);
  }

  const resources = Array.isArray(state.manifest.resources)
    ? state.manifest.resources.filter((item) => {
        if (typeof item !== "object" || item === null) return true;
        const value = item as { source?: string; rendered?: string };
        return !deletedPaths.has(value.source ?? "") && !deletedPaths.has(value.rendered ?? "");
      })
    : state.manifest.resources;

  return {
    ...state,
    dirty: true,
    manifest: { ...state.manifest, resources },
    files: state.files
      .filter((file) => !deletedPaths.has(file.path))
      .map((file) => ({
        ...file,
        content: file.is_text && file.content !== null && /\.(md|markdown)$/i.test(file.path)
          ? removeMarkdownAssetReferences(file.content, file.path, deletedPaths)
          : file.content,
      })),
  };
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

  if (resource && ["drawing", "plantuml", "mermaid", "mathjax"].includes(resource.type)) {
    const suffixPattern = resource.type === "drawing"
      ? /(?:\.draw\.json|\.svg)$/i
      : resource.type === "plantuml"
        ? /(?:\.puml|\.svg)$/i
        : resource.type === "mermaid"
          ? /(?:\.mmd|\.svg)$/i
          : /(?:\.tex|\.svg)$/i;
    const sourceSuffix = resource.type === "drawing"
      ? ".draw.json"
      : resource.type === "plantuml" ? ".puml" : resource.type === "mermaid" ? ".mmd" : ".tex";
    const name = safeAssetName(requestedName.replace(suffixPattern, ""));
    const sourceDir = resource.source.includes("/")
      ? `${resource.source.slice(0, resource.source.lastIndexOf("/"))}/`
      : "";
    const renderedDir = resource.rendered.includes("/")
      ? `${resource.rendered.slice(0, resource.rendered.lastIndexOf("/"))}/`
      : "";
    replacements.set(resource.source, `${sourceDir}${name}${sourceSuffix}`);
    replacements.set(resource.rendered, `${renderedDir}${name}.svg`);
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
    manifest: { ...state.manifest, version: "2.0" },
    files: state.files.map((f) => ({
      path: f.path,
      is_text: f.is_text,
      content: f.content,
      base64: f.base64,
    })),
  };
}

export function toFolderSaveRequest(state: DocumentState): FolderSaveRequest {
  if (state.origin.kind !== "folder") throw new Error("Document is not in Folder mode");
  return { ...toSaveRequest(state), path: state.origin.path, original_paths: state.originalPaths };
}

export function markSaved(state: DocumentState): DocumentState {
  return {
    ...state,
    dirty: false,
    originalPaths: state.files.map((file) => file.path),
    folderSnapshot: state.origin.kind === "folder" ? folderDocumentFingerprint(state) : state.folderSnapshot,
  };
}
