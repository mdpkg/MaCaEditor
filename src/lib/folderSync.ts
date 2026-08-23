import type { PackageInfo } from "../types";
import type { DocumentState } from "./document";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

function fingerprint(manifest: Record<string, unknown>, entrypoint: string, files: PackageInfo["files"]): string {
  return JSON.stringify({
    manifest: canonical(manifest),
    entrypoint,
    files: [...files]
      .sort((left, right) => left.path.localeCompare(right.path))
      .map((file) => ({
        path: file.path,
        is_text: file.is_text,
        content: file.content,
        base64: file.base64,
      })),
  });
}

export function folderInfoFingerprint(info: PackageInfo): string {
  return fingerprint(info.manifest, info.entrypoint, info.files);
}

export function folderDocumentFingerprint(state: DocumentState): string {
  return fingerprint(state.manifest, state.entrypoint, state.files);
}

export type ExternalFolderAction = "unchanged" | "reload" | "conflict";

export function externalFolderAction(state: DocumentState, info: PackageInfo): ExternalFolderAction {
  const baseline = state.folderSnapshot ?? folderDocumentFingerprint(state);
  if (folderInfoFingerprint(info) === baseline) return "unchanged";
  return state.dirty ? "conflict" : "reload";
}
