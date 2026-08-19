/**
 * Markdown の相対パスをパッケージ内パスとして解決する。
 * パッケージ外へ出る参照は拒否する。
 */
export function resolvePackagePath(baseDir: string, target: string): string | null {
  const normalizedTarget = target.replace(/\\/g, "/").replace(/^\.\//, "");
  if (normalizedTarget.startsWith("/")) {
    return null;
  }
  const segments = normalizedTarget.split("/");
  if (segments.some((s) => s === "..")) {
    return null;
  }
  const baseSegments = baseDir === "" ? [] : baseDir.split("/");
  const joined = [...baseSegments, ...segments];
  return joined.join("/");
}
