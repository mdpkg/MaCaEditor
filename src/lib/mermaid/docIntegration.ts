import type { DocumentState } from "../document";
import {
  addTextDiagram, findTextDiagramResource, saveTextDiagram,
  type AddTextDiagramOptions, type TextDiagramResource,
} from "../textDiagramDocument";

export const DEFAULT_MERMAID_DIR = "diagrams";
export const DEFAULT_MERMAID_SOURCE = `flowchart LR
  Start([Start]) --> Process[Process]
  Process --> End([End])`;

export type MermaidResource = TextDiagramResource<"mermaid">;

export function findMermaidResourceBySource(
  manifest: Record<string, unknown>, source: string,
): MermaidResource | undefined {
  return findTextDiagramResource(manifest, "mermaid", "source", source);
}

export function findMermaidResourceByRendered(
  manifest: Record<string, unknown>, rendered: string,
): MermaidResource | undefined {
  return findTextDiagramResource(manifest, "mermaid", "rendered", rendered);
}

export function addMermaidToDocument(
  state: DocumentState, source: string, svg: string, alt: string, options: AddTextDiagramOptions = {},
): { state: DocumentState; sourcePath: string; svgPath: string; cursor: number } {
  return addTextDiagram(state, { type: "mermaid", prefix: "mermaid", extension: "mmd" }, source, svg, alt, options);
}

export function saveMermaidToDocument(
  state: DocumentState, sourcePath: string, source: string, svg: string,
): DocumentState {
  return saveTextDiagram(state, "mermaid", sourcePath, source, svg, "Mermaid");
}
