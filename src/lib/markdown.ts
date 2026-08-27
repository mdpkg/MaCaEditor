export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

/**
 * Markdown の相対パスをパッケージ内パスとして解決する。
 * パッケージ外へ出る参照は拒否する。
 */
export function resolvePackagePath(baseDir: string, target: string): string | null {
  const normalizedTarget = target.replace(/\\/g, "/").replace(/^\.\//, "");
  if (normalizedTarget.startsWith("/") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(normalizedTarget)) {
    return null;
  }
  const resolved = baseDir === "" ? [] : baseDir.split("/");
  for (const segment of normalizedTarget.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (resolved.length === 0) return null;
      resolved.pop();
    } else {
      resolved.push(segment);
    }
  }
  return resolved.join("/");
}

/** パッケージ内の文書から別ファイルを参照する相対パスを作る。 */
export function relativePackagePath(fromFile: string, toFile: string): string {
  const from = fromFile.split("/").slice(0, -1);
  const to = toFile.split("/");
  while (from.length > 0 && to.length > 0 && from[0] === to[0]) {
    from.shift();
    to.shift();
  }
  return [...from.map(() => ".."), ...to].join("/");
}

function markdownDestination(path: string): string {
  return /[\s()]/.test(path) ? `<${path}>` : path;
}

export function packageFileMarkdownLink(
  markdownPath: string,
  droppedPath: string,
  files: FileInfo[],
  manifest: Record<string, unknown>,
): string {
  const file = files.find((candidate) => candidate.path === droppedPath);
  if (!file) throw new Error(`Package file not found: ${droppedPath}`);
  const resource = Array.isArray(manifest.resources)
    ? manifest.resources.find((item) => typeof item === "object" && item !== null &&
        ((item as { source?: string }).source === droppedPath ||
          (item as { rendered?: string }).rendered === droppedPath)) as
        | { source?: string; rendered?: string }
        | undefined
    : undefined;
  const targetPath = resource?.rendered ?? droppedPath;
  const relativePath = markdownDestination(relativePackagePath(markdownPath, targetPath));
  const fileName = targetPath.slice(targetPath.lastIndexOf("/") + 1);
  const isAttachment = /(^|\/)attachments\//.test(droppedPath);
  const imageLink = !isAttachment &&
    (resource !== undefined || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(targetPath));
  if (imageLink) {
    const alt = fileName.replace(/\.[^.]+$/, "").replace(/[\[\]]/g, "\\$&");
    return `![${alt}](${relativePath})`;
  }
  const label = fileName.replace(/[\[\]]/g, "\\$&");
  return `[${label}](${relativePath})`;
}

export function insertMarkdownImages(
  content: string,
  cursor: number | null,
  markdownPath: string,
  imagePaths: string[],
  altTexts?: string[],
): { content: string; cursor: number } {
  const position = cursor === null ? content.length : Math.max(0, Math.min(cursor, content.length));
  const links = imagePaths.map((path, index) => {
    const fileName = path.slice(path.lastIndexOf("/") + 1);
    const alt = altTexts?.[index] ?? fileName.replace(/\.[^.]+$/, "");
    const relativePath = relativePackagePath(markdownPath, path);
    const destination = /\s/.test(relativePath) ? `<${relativePath}>` : relativePath;
    return `![${alt}](${destination})`;
  }).join("\n");
  const before = content.slice(0, position);
  const after = content.slice(position);
  const prefix = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
  const suffix = after.length > 0 && !after.startsWith("\n") ? "\n" : "";
  const insertion = `${prefix}${links}${suffix}`;
  return {
    content: before + insertion + after,
    cursor: position + insertion.length - suffix.length,
  };
}

export function insertMarkdownLinks(
  content: string,
  cursor: number | null,
  markdownPath: string,
  filePaths: string[],
  labels?: string[],
): { content: string; cursor: number } {
  const links = filePaths.map((path, index) => {
    const fileName = path.slice(path.lastIndexOf("/") + 1);
    const relativePath = relativePackagePath(markdownPath, path);
    const destination = /[\s()]/.test(relativePath) ? `<${relativePath}>` : relativePath;
    const label = (labels?.[index] ?? fileName).replace(/[\[\]]/g, "\\$&");
    return `[${label}](${destination})`;
  }).join("\n");
  return insertMarkdownBlock(content, cursor, links);
}

export function insertMarkdownBlock(
  content: string,
  cursor: number | null,
  block: string,
): { content: string; cursor: number } {
  const position = cursor === null ? content.length : Math.max(0, Math.min(cursor, content.length));
  const before = content.slice(0, position);
  const after = content.slice(position);
  const prefix = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
  const suffix = after.length > 0 && !after.startsWith("\n") ? "\n" : "";
  const insertion = `${prefix}${block}${suffix}`;
  return {
    content: before + insertion + after,
    cursor: position + insertion.length - suffix.length,
  };
}
import type { FileInfo } from "../types";
