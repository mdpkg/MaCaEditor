import type { DocumentState } from "../document";
import { insertMarkdownImages } from "../markdown";

export const DEFAULT_MATHJAX_DIR = "diagrams";
export const DEFAULT_MATHJAX_SOURCE = String.raw`\frac{-b \pm \sqrt{b^2 - 4ac}}{2a}`;

export interface MathJaxResource {
  source: string;
  rendered: string;
  type: "mathjax";
}

function findResource(
  manifest: Record<string, unknown>,
  predicate: (resource: MathJaxResource) => boolean,
): MathJaxResource | undefined {
  if (!Array.isArray(manifest.resources)) return undefined;
  return manifest.resources.find((item): item is MathJaxResource =>
    typeof item === "object" && item !== null &&
    (item as { type?: string }).type === "mathjax" &&
    predicate(item as MathJaxResource),
  );
}

export function findMathJaxResourceBySource(
  manifest: Record<string, unknown>, source: string,
): MathJaxResource | undefined {
  return findResource(manifest, (resource) => resource.source === source);
}

export function findMathJaxResourceByRendered(
  manifest: Record<string, unknown>, rendered: string,
): MathJaxResource | undefined {
  return findResource(manifest, (resource) => resource.rendered === rendered);
}

function nextName(state: DocumentState, baseDir: string): string {
  const used = new Set(state.files.map((file) => file.path.toLowerCase()));
  let sequence = 1;
  while (
    used.has(`${baseDir}/math-${sequence}.tex`.toLowerCase()) ||
    used.has(`${baseDir}/math-${sequence}.svg`.toLowerCase())
  ) sequence += 1;
  return `math-${sequence}`;
}

export function addMathJaxToDocument(
  state: DocumentState,
  source: string,
  svg: string,
  alt: string,
  options: { baseDir?: string; markdownPath?: string; cursor?: number | null } = {},
): { state: DocumentState; sourcePath: string; svgPath: string; cursor: number } {
  const baseDir = options.baseDir ?? DEFAULT_MATHJAX_DIR;
  const name = nextName(state, baseDir);
  const sourcePath = `${baseDir}/${name}.tex`;
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
        resources: [...resources, { source: sourcePath, rendered: svgPath, type: "mathjax" }],
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

export function saveMathJaxToDocument(
  state: DocumentState, sourcePath: string, source: string, svg: string,
): DocumentState {
  const resource = findMathJaxResourceBySource(state.manifest, sourcePath);
  if (!resource) throw new Error(`MathJax resource not found: ${sourcePath}`);
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
