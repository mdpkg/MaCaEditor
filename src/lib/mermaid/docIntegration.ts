import type { DocumentState } from "../document";
import { insertMarkdownImages } from "../markdown";

export const DEFAULT_MERMAID_DIR = "diagrams";
export const DEFAULT_MERMAID_SOURCE = `flowchart LR
  Start([Start]) --> Process[Process]
  Process --> End([End])`;

export interface MermaidResource {
  source: string;
  rendered: string;
  type: "mermaid";
}

function findResource(
  manifest: Record<string, unknown>,
  predicate: (resource: MermaidResource) => boolean,
): MermaidResource | undefined {
  if (!Array.isArray(manifest.resources)) return undefined;
  return manifest.resources.find((item): item is MermaidResource =>
    typeof item === "object" && item !== null &&
    (item as { type?: string }).type === "mermaid" &&
    predicate(item as MermaidResource),
  );
}

export function findMermaidResourceBySource(
  manifest: Record<string, unknown>, source: string,
): MermaidResource | undefined {
  return findResource(manifest, (resource) => resource.source === source);
}

export function findMermaidResourceByRendered(
  manifest: Record<string, unknown>, rendered: string,
): MermaidResource | undefined {
  return findResource(manifest, (resource) => resource.rendered === rendered);
}

function nextName(state: DocumentState, baseDir: string): string {
  const used = new Set(state.files.map((file) => file.path.toLowerCase()));
  let sequence = 1;
  while (
    used.has(`${baseDir}/mermaid-${sequence}.mmd`.toLowerCase()) ||
    used.has(`${baseDir}/mermaid-${sequence}.svg`.toLowerCase())
  ) sequence += 1;
  return `mermaid-${sequence}`;
}

export function addMermaidToDocument(
  state: DocumentState,
  source: string,
  svg: string,
  alt: string,
  options: { baseDir?: string; markdownPath?: string; cursor?: number | null } = {},
): { state: DocumentState; sourcePath: string; svgPath: string; cursor: number } {
  const baseDir = options.baseDir ?? DEFAULT_MERMAID_DIR;
  const name = nextName(state, baseDir);
  const sourcePath = `${baseDir}/${name}.mmd`;
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
        resources: [...resources, { source: sourcePath, rendered: svgPath, type: "mermaid" }],
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

export function saveMermaidToDocument(
  state: DocumentState, sourcePath: string, source: string, svg: string,
): DocumentState {
  const resource = findMermaidResourceBySource(state.manifest, sourcePath);
  if (!resource) throw new Error(`Mermaid resource not found: ${sourcePath}`);
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
