import type { DocumentState } from "./document";
import { isMarkdownPath, resolvePackagePath } from "./markdown";
import type { FileInfo } from "../types";
import { markdownLinks } from "./markdownLinks";

export type DiagnosticCode =
  | "missing-link" | "outside-package-link" | "link-case-mismatch"
  | "missing-resource" | "invalid-resource" | "unreferenced-file"
  | "unsafe-path" | "path-collision" | "invalid-markdown-encoding" | "stale-resource";

export interface PackageDiagnostic {
  code: DiagnosticCode;
  severity: "error" | "warning";
  message: string;
  path: string;
  target?: string;
  offset?: number;
  line?: number;
}

function safePackagePath(path: string): boolean {
  if (!path || path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:/.test(path)) return false;
  return !path.replace(/\\/g, "/").split("/")
    .some((segment) => !segment || segment === "." || segment.startsWith(".."));
}

function lineAt(content: string, offset: number): number {
  return content.slice(0, offset).split("\n").length;
}

// Document edits replace only changed FileInfo objects. Removed files can be collected with their links.
const linksByFile = new WeakMap<FileInfo, ReturnType<typeof markdownLinks>>();

function parsedLinks(file: FileInfo, content: string) {
  let links = linksByFile.get(file);
  if (!links) {
    links = markdownLinks(content);
    linksByFile.set(file, links);
  }
  return links;
}

export function diagnosePackage(state: DocumentState): PackageDiagnostic[] {
  const diagnostics: PackageDiagnostic[] = [];
  const exactPaths = new Set(state.files.map((file) => file.path));
  const foldedPaths = new Map(state.files.map((file) => [file.path.normalize("NFC").toLocaleLowerCase(), file.path]));
  const referenced = new Set<string>([state.entrypoint]);

  for (const file of state.files) {
    if (!file.is_text || file.content === null || !isMarkdownPath(file.path)) continue;
    const baseDir = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";
    for (const link of parsedLinks(file, file.content)) {
      const targetPath = link.destination.split(/[?#]/, 1)[0];
      if (!targetPath || link.destination.startsWith("#") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(link.destination)) continue;
      let decoded = targetPath;
      try { decoded = decodeURIComponent(targetPath); } catch { /* diagnose using the literal path */ }
      const resolved = resolvePackagePath(baseDir, decoded);
      if (resolved && exactPaths.has(resolved)) {
        referenced.add(resolved);
        continue;
      }
      const location = { path: file.path, target: link.destination, offset: link.start, line: lineAt(file.content, link.start) };
      if (!resolved) {
        diagnostics.push({ code: "outside-package-link", severity: "error", message: `パッケージの外を参照するリンクです。 ${link.destination}`, ...location });
        continue;
      }
      const caseMatch = foldedPaths.get(resolved.normalize("NFC").toLocaleLowerCase());
      if (caseMatch) {
        referenced.add(caseMatch);
        diagnostics.push({ code: "link-case-mismatch", severity: "warning", message: `リンクの大文字・小文字が異なります。 ${caseMatch}`, ...location });
      } else {
        diagnostics.push({ code: "missing-link", severity: "error", message: `リンク先のファイルがありません。 ${link.destination}`, ...location });
      }
    }
  }

  const resources = Array.isArray(state.manifest.resources) ? state.manifest.resources : [];
  for (const item of resources) {
    if (typeof item !== "object" || item === null) {
      diagnostics.push({ code: "invalid-resource", severity: "error", message: "リソースの指定が正しくありません。", path: "manifest.json" });
      continue;
    }
    const resource = item as { source?: unknown; rendered?: unknown };
    for (const field of ["source", "rendered"] as const) {
      const target = resource[field];
      if (typeof target !== "string" || !target) {
        diagnostics.push({ code: "invalid-resource", severity: "error", message: `リソースの ${field} がありません。`, path: "manifest.json" });
      } else if (!exactPaths.has(target)) {
        diagnostics.push({ code: "missing-resource", severity: "error", message: `リソースのファイルがありません。 ${target}`, path: "manifest.json", target });
      } else {
        referenced.add(target);
      }
    }
  }

  for (const file of state.files) {
    if (!referenced.has(file.path)) diagnostics.push({
      code: "unreferenced-file", severity: "warning", message: `参照されていないファイルです。 ${file.path}`, path: file.path,
    });
  }

  const canonicalPaths = new Map<string, string>();
  for (const file of state.files) {
    if (!safePackagePath(file.path)) diagnostics.push({ code: "unsafe-path", severity: "error", message: `安全でないパスです。 ${file.path}`, path: file.path });
    const key = file.path.replace(/\\/g, "/").normalize("NFC").toLocaleLowerCase();
    const previous = canonicalPaths.get(key);
    if (previous && previous !== file.path) diagnostics.push({ code: "path-collision", severity: "error", message: `パスが競合しています。 ${previous}`, path: file.path, target: previous });
    else canonicalPaths.set(key, file.path);
    if (isMarkdownPath(file.path) && !file.is_text) diagnostics.push({
      code: "invalid-markdown-encoding", severity: "error", message: `Markdown が UTF-8 ではありません。 ${file.path}`, path: file.path,
    });
  }
  for (const target of state.staleResources ?? []) diagnostics.push({
    code: "stale-resource", severity: "warning", message: `描画済みのリソースがソースより古い状態です。 ${target}`,
    path: "manifest.json", target,
  });
  return diagnostics;
}
