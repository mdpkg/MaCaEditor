import { updateRenderedDiagram, type DocumentState } from "./document";
import { insertMarkdownImages } from "./markdown";

export type TextDiagramType = "plantuml" | "mermaid" | "mathjax";

export interface TextDiagramResource<T extends TextDiagramType = TextDiagramType> {
  source: string;
  rendered: string;
  type: T;
}

export interface AddTextDiagramOptions {
  baseDir?: string;
  markdownPath?: string;
  cursor?: number | null;
}

export function findTextDiagramResource<T extends TextDiagramType>(
  manifest: Record<string, unknown>, type: T, field: "source" | "rendered", path: string,
): TextDiagramResource<T> | undefined {
  if (!Array.isArray(manifest.resources)) return undefined;
  return manifest.resources.find((item): item is TextDiagramResource<T> =>
    typeof item === "object" && item !== null && item.type === type &&
    typeof item.source === "string" && typeof item.rendered === "string" && item[field] === path,
  );
}

/** Source and SVG are one document operation, independent of rendering engines. */
export function addTextDiagram(
  state: DocumentState,
  format: { type: TextDiagramType; prefix: string; extension: string },
  source: string, svg: string, alt: string, options: AddTextDiagramOptions = {},
): { state: DocumentState; sourcePath: string; svgPath: string; cursor: number } {
  const baseDir = options.baseDir ?? "diagrams";
  const used = new Set(state.files.map((file) => file.path.toLowerCase()));
  let sequence = 1;
  const paths = () => {
    const stem = `${baseDir}/${format.prefix}-${sequence}`;
    return { sourcePath: `${stem}.${format.extension}`, svgPath: `${stem}.svg` };
  };
  while (used.has(paths().sourcePath.toLowerCase()) || used.has(paths().svgPath.toLowerCase())) sequence += 1;
  const { sourcePath, svgPath } = paths();
  const markdownPath = options.markdownPath ?? state.entrypoint;
  const markdownFile = state.files.find((file) => file.path === markdownPath);
  const inserted = insertMarkdownImages(
    markdownFile?.content ?? "", options.cursor ?? null, markdownPath, [svgPath], [alt],
  );
  const resources = Array.isArray(state.manifest.resources) ? state.manifest.resources : [];
  return {
    sourcePath, svgPath, cursor: inserted.cursor,
    state: {
      ...state, dirty: true,
      manifest: { ...state.manifest, resources: [...resources, { source: sourcePath, rendered: svgPath, type: format.type }] },
      files: [
        ...state.files.map((file) => file.path === markdownPath ? { ...file, content: inserted.content } : file),
        { path: sourcePath, is_text: true, content: source, base64: null },
        { path: svgPath, is_text: true, content: svg, base64: null },
      ],
    },
  };
}

export function saveTextDiagram(
  state: DocumentState, type: TextDiagramType, sourcePath: string, source: string, svg: string, label: string,
): DocumentState {
  const resource = findTextDiagramResource(state.manifest, type, "source", sourcePath);
  if (!resource) throw new Error(`${label} resource not found: ${sourcePath}`);
  return updateRenderedDiagram(state, sourcePath, resource.rendered, source, svg);
}
