import type { FileContent, FileInfo, FolderSaveRequest, PackageInfo } from "../types";

export type DocumentOrigin =
  | { kind: "package"; path: string }
  | { kind: "folder"; path: string }
  | { kind: "untitled" };
import { relativePackagePath, resolvePackagePath } from "./markdown";
import { markdownLinks, rewriteMarkdownLinkDestinations } from "./markdownLinks";
import { folderDocumentFingerprint, folderInfoFingerprint } from "./folderSync";

export interface DocumentState {
  path: string | null;
  origin: DocumentOrigin;
  originalPaths: string[];
  entrypoint: string;
  files: FileInfo[];
  /** Empty directories exist only for the current editing session. */
  directories?: string[];
  manifest: Record<string, unknown>;
  dirty: boolean;
  folderSnapshot?: string;
  /** Rendered resource paths whose source has changed since the last render. */
  staleResources?: string[];
}

export function createDocumentState(info: PackageInfo, origin: DocumentOrigin | string): DocumentState {
  const resolvedOrigin = typeof origin === "string" ? { kind: "package" as const, path: origin } : origin;
  return {
    path: resolvedOrigin.kind === "untitled" ? null : resolvedOrigin.path,
    origin: resolvedOrigin,
    originalPaths: info.files.map((file) => file.path),
    entrypoint: info.entrypoint,
    files: info.files,
    directories: inferDirectories(info.files.map((file) => file.path)),
    manifest: info.manifest,
    dirty: false,
  };
}

function inferDirectories(paths: string[]): string[] {
  const directories = new Set<string>();
  for (const path of paths) {
    const segments = path.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      directories.add(segments.slice(0, index).join("/"));
    }
  }
  return [...directories].sort();
}

function validateNewPackagePath(path: string): string {
  const normalized = path.normalize("NFC").replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
    throw new Error("A relative package path is required");
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." ||
    /[<>:"|?*\u0000-\u001f]/.test(segment))) {
    throw new Error(`Invalid package path: ${path}`);
  }
  return normalized;
}

function pathExists(state: DocumentState, path: string): boolean {
  const key = path.toLowerCase();
  return state.files.some((file) => file.path.toLowerCase() === key) ||
    (state.directories ?? inferDirectories(state.files.map((file) => file.path)))
      .some((directory) => directory.toLowerCase() === key);
}

function assertNoFileAncestor(state: DocumentState, path: string): void {
  const segments = path.split("/");
  for (let index = 1; index < segments.length; index += 1) {
    const ancestor = segments.slice(0, index).join("/").toLowerCase();
    if (state.files.some((file) => file.path.toLowerCase() === ancestor)) {
      throw new Error(`Path already exists as a file: ${segments.slice(0, index).join("/")}`);
    }
  }
}

export function addDirectory(state: DocumentState, requestedPath: string): DocumentState {
  const path = validateNewPackagePath(requestedPath);
  assertNoFileAncestor(state, path);
  if (pathExists(state, path)) throw new Error(`Path already exists: ${path}`);
  const currentDirectories = state.directories ?? inferDirectories(state.files.map((file) => file.path));
  return { ...state, dirty: true, directories: [...new Set([...currentDirectories, ...inferDirectories([`${path}/x`])])].sort() };
}

export function addMarkdown(state: DocumentState, requestedPath: string, content = ""): DocumentState {
  const path = validateNewPackagePath(requestedPath);
  assertNoFileAncestor(state, path);
  if (!/\.(md|markdown)$/i.test(path)) throw new Error("Markdown files must use .md or .markdown");
  if (pathExists(state, path)) throw new Error(`Path already exists: ${path}`);
  const files = [...state.files, { path, is_text: true, content, base64: null }];
  return { ...state, dirty: true, files, directories: inferDirectories(files.map((file) => file.path)) };
}

export function setEntrypoint(state: DocumentState, requestedPath: string): DocumentState {
  const path = validateNewPackagePath(requestedPath);
  const file = state.files.find((candidate) => candidate.path === path);
  if (!file || !file.is_text || !/\.(md|markdown)$/i.test(path)) {
    throw new Error("Entrypoint must be an existing Markdown file");
  }
  return { ...state, dirty: true, entrypoint: path, manifest: { ...state.manifest, entrypoint: path } };
}

export interface EditableManifestResource {
  type: string;
  source: string;
  rendered: string;
}

export function updateManifestMetadata(
  state: DocumentState,
  values: { entrypoint: string; description: string; resources: EditableManifestResource[] },
): DocumentState {
  const withEntrypoint = setEntrypoint(state, values.entrypoint);
  for (const resource of values.resources) {
    if (!resource.type.trim() || !resource.source || !resource.rendered) {
      throw new Error("Resource type, source, and rendered are required");
    }
    for (const path of [resource.source, resource.rendered]) {
      validateNewPackagePath(path);
      if (!state.files.some((file) => file.path === path)) throw new Error(`Resource file does not exist: ${path}`);
    }
  }
  const manifest: Record<string, unknown> = {
    ...withEntrypoint.manifest, resources: values.resources.map((resource) => ({ ...resource })),
  };
  if (values.description.trim()) manifest.description = values.description.trim();
  else delete manifest.description;
  return { ...withEntrypoint, manifest };
}

function replacePathPrefix(path: string, from: string, to: string): string {
  return path === from ? to : path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : path;
}

function rewriteMarkdownLinksForMove(
  content: string,
  oldMarkdownPath: string,
  newMarkdownPath: string,
  moveTarget: (path: string) => string,
): string {
  return rewriteMarkdownLinkDestinations(content, (target, link) => {
    if (target.startsWith("#") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)) return null;
    const parts = target.match(/^([^?#]*)([?#].*)?$/);
    if (!parts || !parts[1]) return null;
    let decodedPath: string;
    try { decodedPath = decodeURIComponent(parts[1]); } catch { decodedPath = parts[1]; }
    const oldBaseDir = oldMarkdownPath.includes("/")
      ? oldMarkdownPath.slice(0, oldMarkdownPath.lastIndexOf("/"))
      : "";
    const resolved = resolvePackagePath(oldBaseDir, decodedPath);
    if (!resolved) return null;
    const movedTarget = moveTarget(resolved);
    if (oldMarkdownPath === newMarkdownPath && resolved === movedTarget) return null;
    const relative = relativePackagePath(newMarkdownPath, movedTarget);
    const replacement = relative + (parts[2] ?? "");
    const alreadyAngled = content[link.start - 1] === "<" && content[link.end] === ">";
    return alreadyAngled ? replacement : formattedMarkdownDestination(replacement);
  });
}

export function movePath(state: DocumentState, requestedFrom: string, requestedTo: string): DocumentState {
  const from = validateNewPackagePath(requestedFrom);
  const to = validateNewPackagePath(requestedTo);
  if (to === from || to.startsWith(`${from}/`)) throw new Error("A path cannot be moved into itself");
  if (pathExists(state, to)) throw new Error(`Path already exists: ${to}`);
  assertNoFileAncestor(state, to);
  const pairedMoves = new Map<string, string>();
  const resourcesList = Array.isArray(state.manifest.resources) ? state.manifest.resources : [];
  for (const item of resourcesList) {
    if (typeof item !== "object" || item === null) continue;
    const resource = item as { source?: unknown; rendered?: unknown };
    if (typeof resource.source !== "string" || typeof resource.rendered !== "string") continue;
    const partner = resource.source === from ? resource.rendered : resource.rendered === from ? resource.source : null;
    if (!partner) continue;
    const destinationDirectory = to.includes("/") ? to.slice(0, to.lastIndexOf("/")) : "";
    const partnerName = partner.slice(partner.lastIndexOf("/") + 1);
    pairedMoves.set(partner, destinationDirectory ? `${destinationDirectory}/${partnerName}` : partnerName);
  }
  const movedPath = (path: string) => pairedMoves.get(path) ?? replacePathPrefix(path, from, to);
  const affectedFiles = state.files.filter((file) =>
    file.path === from || file.path.startsWith(`${from}/`) || pairedMoves.has(file.path));
  const currentDirectories = state.directories ?? inferDirectories(state.files.map((file) => file.path));
  const affectedDirectories = currentDirectories.filter((directory) => directory === from || directory.startsWith(`${from}/`));
  if (affectedFiles.length === 0 && affectedDirectories.length === 0) throw new Error(`Path not found: ${from}`);
  const unaffected = new Set(state.files.filter((file) => !affectedFiles.includes(file)).map((file) => file.path.toLowerCase()));
  for (const file of affectedFiles) {
    const next = movedPath(file.path).toLowerCase();
    if (unaffected.has(next)) throw new Error(`Path already exists: ${next}`);
  }
  const entrypoint = movedPath(state.entrypoint);
  const resources = Array.isArray(state.manifest.resources)
    ? state.manifest.resources.map((item) => {
        if (typeof item !== "object" || item === null) return item;
        const resource = item as Record<string, unknown>;
        return {
          ...resource,
          source: typeof resource.source === "string" ? movedPath(resource.source) : resource.source,
          rendered: typeof resource.rendered === "string" ? movedPath(resource.rendered) : resource.rendered,
        };
      })
    : state.manifest.resources;
  const files = state.files.map((file) => {
    const nextPath = movedPath(file.path);
    const content = file.is_text && file.content !== null && /\.(md|markdown)$/i.test(file.path)
      ? rewriteMarkdownLinksForMove(file.content, file.path, nextPath, movedPath)
      : file.content;
    return { ...file, path: nextPath, content };
  });
  const transientDirectories = currentDirectories.map((directory) => replacePathPrefix(directory, from, to));
  return {
    ...state, dirty: true, entrypoint, files,
    staleResources: (state.staleResources ?? []).map(movedPath),
    directories: [...new Set([...inferDirectories(files.map((file) => file.path)), ...transientDirectories])].sort(),
    manifest: { ...state.manifest, entrypoint, resources },
  };
}

export function deletePath(state: DocumentState, requestedPath: string): DocumentState {
  const path = validateNewPackagePath(requestedPath);
  const pairedPaths = new Set<string>();
  if (Array.isArray(state.manifest.resources)) {
    for (const item of state.manifest.resources) {
      if (typeof item !== "object" || item === null) continue;
      const resource = item as { source?: unknown; rendered?: unknown };
      if (resource.source === path || resource.rendered === path) {
        if (typeof resource.source === "string") pairedPaths.add(resource.source);
        if (typeof resource.rendered === "string") pairedPaths.add(resource.rendered);
      }
    }
  }
  const removes = (candidate: string) => pairedPaths.has(candidate) || candidate === path || candidate.startsWith(`${path}/`);
  if (removes(state.entrypoint)) throw new Error("Select another entrypoint before deleting the current entrypoint");
  const files = state.files.filter((file) => !removes(file.path));
  const currentDirectories = state.directories ?? inferDirectories(state.files.map((file) => file.path));
  const directories = currentDirectories.filter((directory) => !removes(directory));
  if (files.length === state.files.length && directories.length === currentDirectories.length) {
    throw new Error(`Path not found: ${path}`);
  }
  const resources = Array.isArray(state.manifest.resources)
    ? state.manifest.resources.filter((item) => {
        if (typeof item !== "object" || item === null) return true;
        const resource = item as { source?: string; rendered?: string };
        return !removes(resource.source ?? "") && !removes(resource.rendered ?? "");
      })
    : state.manifest.resources;
  return {
    ...state, dirty: true, files, directories,
    staleResources: (state.staleResources ?? []).filter((candidate) => !removes(candidate)),
    manifest: { ...state.manifest, resources },
  };
}

export function pathReferenceCount(state: DocumentState, requestedPath: string): number {
  const path = validateNewPackagePath(requestedPath);
  let count = 0;
  for (const file of state.files) {
    if (!file.is_text || file.content === null || !/\.(md|markdown)$/i.test(file.path)) continue;
    const baseDir = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";
    for (const link of markdownLinks(file.content)) {
      const rawPath = link.destination.split(/[?#]/, 1)[0];
      if (!rawPath || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(link.destination)) continue;
      let decoded = rawPath;
      try { decoded = decodeURIComponent(rawPath); } catch { /* use the literal destination */ }
      const resolved = resolvePackagePath(baseDir, decoded);
      if (resolved === path || resolved?.startsWith(`${path}/`)) count += 1;
    }
  }
  return count;
}

export function createFolderDocumentState(info: PackageInfo, path: string): DocumentState {
  return { ...createDocumentState(info, { kind: "folder", path }), folderSnapshot: folderInfoFingerprint(info) };
}

export function updateFileContent(
  state: DocumentState,
  filePath: string,
  content: string,
): DocumentState {
  const stale = new Set(state.staleResources ?? []);
  if (Array.isArray(state.manifest.resources)) {
    for (const item of state.manifest.resources) {
      if (typeof item !== "object" || item === null) continue;
      const resource = item as { source?: unknown; rendered?: unknown };
      if (resource.source === filePath && typeof resource.rendered === "string") stale.add(resource.rendered);
      if (resource.rendered === filePath) stale.delete(filePath);
    }
  }
  return {
    ...state,
    dirty: true,
    staleResources: [...stale],
    files: state.files.map((f) =>
      f.path === filePath ? { ...f, content } : f,
    ),
  };
}

export function addImage(
  state: DocumentState,
  fileName: string,
  base64: string,
  markdownPath = state.entrypoint,
): { state: DocumentState; path: string } {
  return addBinaryAsset(state, resourceDirectoryForMarkdown(markdownPath, "images"), fileName, base64);
}

export function addAttachment(
  state: DocumentState,
  fileName: string,
  base64: string,
  markdownPath = state.entrypoint,
): { state: DocumentState; path: string } {
  return addBinaryAsset(state, resourceDirectoryForMarkdown(markdownPath, "attachments"), fileName, base64);
}

export function resourceDirectoryForMarkdown(
  markdownPath: string,
  resourceDirectory: "images" | "diagrams" | "attachments",
): string {
  const separator = markdownPath.lastIndexOf("/");
  return separator < 0 ? resourceDirectory : `${markdownPath.slice(0, separator)}/${resourceDirectory}`;
}

function addBinaryAsset(
  state: DocumentState,
  directory: string,
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
  const savedState = { ...state, manifest: { ...state.manifest, version: "2.0" } };
  return {
    ...savedState,
    dirty: false,
    originalPaths: state.files.map((file) => file.path),
    folderSnapshot: state.origin.kind === "folder" ? folderDocumentFingerprint(savedState) : state.folderSnapshot,
  };
}
