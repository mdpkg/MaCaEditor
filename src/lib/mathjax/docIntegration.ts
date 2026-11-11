import type { DocumentState } from "../document";
import {
  addTextDiagram, findTextDiagramResource, saveTextDiagram,
  type AddTextDiagramOptions, type TextDiagramResource,
} from "../textDiagramDocument";

export const DEFAULT_MATHJAX_DIR = "diagrams";
export const DEFAULT_MATHJAX_SOURCE = String.raw`\frac{-b \pm \sqrt{b^2 - 4ac}}{2a}`;

export type MathJaxResource = TextDiagramResource<"mathjax">;

export function findMathJaxResourceBySource(
  manifest: Record<string, unknown>, source: string,
): MathJaxResource | undefined {
  return findTextDiagramResource(manifest, "mathjax", "source", source);
}

export function findMathJaxResourceByRendered(
  manifest: Record<string, unknown>, rendered: string,
): MathJaxResource | undefined {
  return findTextDiagramResource(manifest, "mathjax", "rendered", rendered);
}

export function addMathJaxToDocument(
  state: DocumentState, source: string, svg: string, alt: string, options: AddTextDiagramOptions = {},
): { state: DocumentState; sourcePath: string; svgPath: string; cursor: number } {
  return addTextDiagram(state, { type: "mathjax", prefix: "math", extension: "tex" }, source, svg, alt, options);
}

export function saveMathJaxToDocument(
  state: DocumentState, sourcePath: string, source: string, svg: string,
): DocumentState {
  return saveTextDiagram(state, "mathjax", sourcePath, source, svg, "MathJax");
}
