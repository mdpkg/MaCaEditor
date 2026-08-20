import type { DrawingDocument } from "./model";
import { renderSvg } from "./svg";
import { serializeDrawingDocument } from "./drawing";

export interface DrawingFiles {
  drawPath: string;
  svgPath: string;
  drawContent: string;
  svgContent: string;
}

/** Drawing を配置する既定ディレクトリ。 */
export const DEFAULT_DRAWING_DIR = "diagrams";

/** Drawing Document から `.draw.json` と `.svg` の両方を生成する。 */
export function generateDrawingFiles(
  doc: DrawingDocument,
  baseDir: string,
  name: string,
): DrawingFiles {
  const drawPath = `${baseDir}/${name}.draw.json`;
  const svgPath = `${baseDir}/${name}.svg`;
  return {
    drawPath,
    svgPath,
    drawContent: serializeDrawingDocument(doc),
    svgContent: renderSvg(doc, {
      fitToContent: doc.canvas.fitToContent !== false,
      margin: 20,
    }),
  };
}

/** 新しい Drawing 名を生成する（既存ファイルを上書きしない）。 */
export function nextDrawingName(
  baseDir: string,
  existingPaths: string[],
  prefix = "drawing",
): string {
  let n = 1;
  let name = `${prefix}-${n}`;
    while (
      existingPaths.includes(`${baseDir}/${name}.draw.json`) ||
      existingPaths.includes(`${baseDir}/${name}.svg`)
    ) {
      n += 1;
      name = `${prefix}-${n}`;
    }
  return name;
}

/** Markdown に挿入する画像参照を生成する。 */
export function markdownImageRef(svgPath: string, alt: string): string {
  return `![${alt}](${svgPath})`;
}
