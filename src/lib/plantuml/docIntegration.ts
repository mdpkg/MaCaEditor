import type { DocumentState } from "../document";
import { insertMarkdownImages } from "../markdown";

export const DEFAULT_PLANTUML_DIR = "diagrams";
export const DEFAULT_PLANTUML_SOURCE = `@startuml
Alice -> Bob: Hello
Bob --> Alice: Hi!
@enduml`;

export interface PlantUmlResource {
  source: string;
  rendered: string;
  type: "plantuml";
}

export function findPlantUmlResourceBySource(
  manifest: Record<string, unknown>,
  source: string,
): PlantUmlResource | undefined {
  if (!Array.isArray(manifest.resources)) return undefined;
  return manifest.resources.find((item): item is PlantUmlResource =>
    typeof item === "object" && item !== null &&
    (item as { type?: string }).type === "plantuml" &&
    (item as { source?: string }).source === source,
  );
}

export function findPlantUmlResourceByRendered(
  manifest: Record<string, unknown>,
  rendered: string,
): PlantUmlResource | undefined {
  if (!Array.isArray(manifest.resources)) return undefined;
  return manifest.resources.find((item): item is PlantUmlResource =>
    typeof item === "object" && item !== null &&
    (item as { type?: string }).type === "plantuml" &&
    (item as { rendered?: string }).rendered === rendered,
  );
}

function nextPlantUmlName(state: DocumentState, baseDir: string): string {
  const used = new Set(state.files.map((file) => file.path.toLowerCase()));
  let sequence = 1;
  while (
    used.has(`${baseDir}/plantuml-${sequence}.puml`.toLowerCase()) ||
    used.has(`${baseDir}/plantuml-${sequence}.svg`.toLowerCase())
  ) sequence += 1;
  return `plantuml-${sequence}`;
}

export function addPlantUmlToDocument(
  state: DocumentState,
  source: string,
  svg: string,
  alt: string,
  options: { baseDir?: string; markdownPath?: string; cursor?: number | null } = {},
): { state: DocumentState; sourcePath: string; svgPath: string; cursor: number } {
  const baseDir = options.baseDir ?? DEFAULT_PLANTUML_DIR;
  const name = nextPlantUmlName(state, baseDir);
  const sourcePath = `${baseDir}/${name}.puml`;
  const svgPath = `${baseDir}/${name}.svg`;
  const markdownPath = options.markdownPath ?? state.entrypoint;
  const markdownFile = state.files.find((file) => file.path === markdownPath);
  const inserted = insertMarkdownImages(
    markdownFile?.content ?? "", options.cursor ?? null, markdownPath, [svgPath], [alt],
  );
  const resources = Array.isArray(state.manifest.resources) ? state.manifest.resources : [];

  return {
    sourcePath,
    svgPath,
    cursor: inserted.cursor,
    state: {
      ...state,
      dirty: true,
      manifest: {
        ...state.manifest,
        resources: [...resources, { source: sourcePath, rendered: svgPath, type: "plantuml" }],
      },
      files: [
        ...state.files.map((file) => file.path === markdownPath
          ? { ...file, content: inserted.content }
          : file),
        { path: sourcePath, is_text: true, content: source, base64: null },
        { path: svgPath, is_text: true, content: svg, base64: null },
      ],
    },
  };
}

export function savePlantUmlToDocument(
  state: DocumentState,
  sourcePath: string,
  source: string,
  svg: string,
): DocumentState {
  const resource = findPlantUmlResourceBySource(state.manifest, sourcePath);
  if (!resource) throw new Error(`PlantUML resource not found: ${sourcePath}`);
  return {
    ...state,
    dirty: true,
    files: state.files.map((file) => {
      if (file.path === sourcePath) return { ...file, content: source };
      if (file.path === resource.rendered) return { ...file, content: svg };
      return file;
    }),
  };
}
