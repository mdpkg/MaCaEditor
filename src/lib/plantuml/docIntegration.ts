import type { DocumentState } from "../document";
import {
  addTextDiagram, findTextDiagramResource, saveTextDiagram,
  type AddTextDiagramOptions, type TextDiagramResource,
} from "../textDiagramDocument";

export const DEFAULT_PLANTUML_DIR = "diagrams";
export const DEFAULT_PLANTUML_SOURCE = `@startuml
Alice -> Bob: Hello
Bob --> Alice: Hi!
@enduml`;

export type PlantUmlResource = TextDiagramResource<"plantuml">;

export function findPlantUmlResourceBySource(
  manifest: Record<string, unknown>, source: string,
): PlantUmlResource | undefined {
  return findTextDiagramResource(manifest, "plantuml", "source", source);
}

export function findPlantUmlResourceByRendered(
  manifest: Record<string, unknown>, rendered: string,
): PlantUmlResource | undefined {
  return findTextDiagramResource(manifest, "plantuml", "rendered", rendered);
}

export function addPlantUmlToDocument(
  state: DocumentState, source: string, svg: string, alt: string, options: AddTextDiagramOptions = {},
): { state: DocumentState; sourcePath: string; svgPath: string; cursor: number } {
  return addTextDiagram(state, { type: "plantuml", prefix: "plantuml", extension: "puml" }, source, svg, alt, options);
}

export function savePlantUmlToDocument(
  state: DocumentState, sourcePath: string, source: string, svg: string,
): DocumentState {
  return saveTextDiagram(state, "plantuml", sourcePath, source, svg, "PlantUML");
}
