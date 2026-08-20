/**
 * Markdown の相対パスをパッケージ内パスとして解決する。
 * パッケージ外へ出る参照は拒否する。
 */
export function resolvePackagePath(baseDir: string, target: string): string | null {
  const normalizedTarget = target.replace(/\\/g, "/").replace(/^\.\//, "");
  if (normalizedTarget.startsWith("/")) {
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

export function insertMarkdownImages(
  content: string,
  cursor: number | null,
  markdownPath: string,
  imagePaths: string[],
): { content: string; cursor: number } {
  const position = cursor === null ? content.length : Math.max(0, Math.min(cursor, content.length));
  const links = imagePaths.map((path) => {
    const fileName = path.slice(path.lastIndexOf("/") + 1);
    const alt = fileName.replace(/\.[^.]+$/, "");
    return `![${alt}](${relativePackagePath(markdownPath, path)})`;
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
