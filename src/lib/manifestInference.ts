import type { FileInfo } from "../types";
import { resolvePackagePath } from "./markdown";
import { markdownLinks } from "./markdownLinks";

export interface ManifestInference {
  manifest: {
    format: "mdpkg";
    version: "2.0";
    entrypoint: string;
    resources: Array<{ type: string; source: string; rendered: string }>;
  };
  warnings: string[];
}

const sourceTypes = [
  { suffix: ".draw.json", type: "drawing" },
  { suffix: ".puml", type: "plantuml" },
  { suffix: ".mmd", type: "mermaid" },
  { suffix: ".tex", type: "mathjax" },
  { suffix: ".dot", type: "graphviz" },
] as const;

function markdownPath(path: string): boolean {
  return /\.(?:md|markdown)$/i.test(path);
}

function chooseEntrypoint(files: FileInfo[]): string {
  const paths = files.filter((file) => file.is_text && markdownPath(file.path)).map((file) => file.path).sort();
  if (paths.length === 0) throw new Error("The selected folder does not contain a Markdown file");
  return paths.find((path) => path === "index.md")
    ?? paths.find((path) => path === "README.md")
    ?? paths[0];
}

function decodedPath(destination: string): string {
  const raw = destination.split(/[?#]/, 1)[0];
  try { return decodeURIComponent(raw); } catch { return raw; }
}

export function inferManifest(files: FileInfo[]): ManifestInference {
  const entrypoint = chooseEntrypoint(files);
  const paths = new Set(files.map((file) => file.path));
  const renderedPaths: string[] = [];
  const warnings: string[] = [];

  for (const file of files) {
    if (!file.is_text || file.content === null || !markdownPath(file.path)) continue;
    const baseDir = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";
    for (const link of markdownLinks(file.content)) {
      if (!link.destination || link.destination.startsWith("#") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(link.destination)) {
        continue;
      }
      const target = decodedPath(link.destination);
      const resolved = resolvePackagePath(baseDir, target);
      if (!resolved) {
        warnings.push(`${file.path}: link escapes the folder: ${link.destination}`);
      } else if (!paths.has(resolved)) {
        warnings.push(`${file.path}: linked file does not exist: ${link.destination}`);
      } else if (link.image && /\.(?:svg|png)$/i.test(resolved) && !renderedPaths.includes(resolved)) {
        renderedPaths.push(resolved);
      }
    }
  }

  const resources = renderedPaths.flatMap((rendered) => {
    const stem = rendered.replace(/\.(?:svg|png)$/i, "");
    const candidates = sourceTypes.flatMap(({ suffix, type }) =>
      paths.has(`${stem}${suffix}`) ? [{ type, source: `${stem}${suffix}`, rendered }] : []);
    if (candidates.length > 1) {
      warnings.push(`Multiple diagram sources match ${rendered}: ${candidates.map((item) => item.source).join(", ")}`);
      return [];
    }
    return candidates;
  });

  return {
    manifest: { format: "mdpkg", version: "2.0", entrypoint, resources },
    warnings,
  };
}
