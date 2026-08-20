import type { DocumentState } from "../document";
import type { DrawingDocument } from "./model";
import { generateDrawingFiles, nextDrawingName } from "./integration";
import { parseAndValidate } from "./drawing";

export interface DrawingResource {
  source: string;
  rendered: string;
  type: string;
}

/** manifest から drawing リソースを抽出する。 */
export function findDrawingResources(
  manifest: Record<string, unknown>,
): DrawingResource[] {
  const resources = manifest.resources;
  if (!Array.isArray(resources)) return [];
  return resources.filter(
    (r): r is DrawingResource =>
      typeof r === "object" &&
      r !== null &&
      (r as { type?: string }).type === "drawing",
  );
}

/** 指定された rendered パスに対応する drawing リソースを返す。 */
export function findResourceByRendered(
  manifest: Record<string, unknown>,
  rendered: string,
): DrawingResource | undefined {
  return findDrawingResources(manifest).find((r) => r.rendered === rendered);
}

/** 指定された source パスに対応する drawing リソースを返す。 */
export function findResourceBySource(
  manifest: Record<string, unknown>,
  source: string,
): DrawingResource | undefined {
  return findDrawingResources(manifest).find((r) => r.source === source);
}

/** 新しい Drawing を Document に追加する。 */
export function addDrawingToDocument(
  state: DocumentState,
  doc: DrawingDocument,
  baseDir: string,
  alt: string,
): { state: DocumentState; drawPath: string; svgPath: string } {
  const name = nextDrawingName(
    baseDir,
    state.files.map((f) => f.path),
  );
  const files = generateDrawingFiles(doc, baseDir, name);
  const entrypoint = state.files.find((f) => f.path === state.entrypoint);
  const entryContent = entrypoint?.content ?? "";
  const imageRef = `![${alt}](${files.svgPath})`;

  const resources = Array.isArray(state.manifest.resources)
    ? state.manifest.resources
    : [];
  const newResource: DrawingResource = {
    source: files.drawPath,
    rendered: files.svgPath,
    type: "drawing",
  };

  const newFiles = [
    ...state.files.map((f) =>
      f.path === state.entrypoint
        ? { ...f, content: `${entryContent}\n\n${imageRef}\n` }
        : f,
    ),
    { path: files.drawPath, is_text: true, content: files.drawContent, base64: null },
    { path: files.svgPath, is_text: true, content: files.svgContent, base64: null },
  ];

  return {
    state: {
      ...state,
      dirty: true,
      files: newFiles,
      manifest: {
        ...state.manifest,
        resources: [...resources, newResource],
      },
    },
    drawPath: files.drawPath,
    svgPath: files.svgPath,
  };
}

/** Drawing Document を保存して SVG を再生成する。 */
export function saveDrawingToDocument(
  state: DocumentState,
  drawPath: string,
  doc: DrawingDocument,
): DocumentState {
  const files = generateDrawingFiles(doc, dirOf(drawPath), nameOf(drawPath));
  return {
    ...state,
    dirty: true,
    files: state.files.map((f) => {
      if (f.path === drawPath) {
        return { ...f, content: files.drawContent };
      }
      if (f.path === files.svgPath) {
        return { ...f, content: files.svgContent };
      }
      return f;
    }),
  };
}

/** パスからディレクトリ部分を返す。 */
export function dirOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(0, idx) : "";
}

/** パスから拡張子なしのファイル名を返す。 */
export function nameOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return base.replace(/\.draw\.json$/, "");
}

/** `.draw.json` の内容をパースして検証する。 */
export function parseDrawingFile(content: string): DrawingDocument {
  return parseAndValidate(content);
}
