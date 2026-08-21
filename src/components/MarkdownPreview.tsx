import ReactMarkdown from "react-markdown";
import type { Components, UrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { FileInfo } from "../types";
import { resolvePackagePath } from "../lib/markdown";
import { sanitizeHtml } from "../lib/sanitize";
import { findResourceByRendered } from "../lib/drawing/docIntegration";
import { imageMediaType } from "../lib/document";

interface Props {
  markdown: string;
  baseDir: string;
  files: FileInfo[];
  manifest?: Record<string, unknown>;
  onEditDrawing?: (drawPath: string) => void;
}

function packageUrl(baseDir: string, url: string): string {
  if (/^(?:https?:|mailto:|#)/i.test(url)) return url;
  return resolvePackagePath(baseDir, decodePackageUrl(url)) ?? "#";
}

function decodePackageUrl(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

function normalizeLegacyImageDestinations(
  markdown: string,
  baseDir: string,
  files: FileInfo[],
): string {
  return markdown.replace(/!\[([^\]\n]*)\]\(([^)\n]+)\)/g, (match, alt: string, target: string) => {
    const trimmed = target.trim();
    if (!/\s/.test(trimmed) || (trimmed.startsWith("<") && trimmed.endsWith(">"))) {
      return match;
    }
    const resolved = resolvePackagePath(baseDir, decodePackageUrl(trimmed));
    if (!resolved || !files.some((file) => file.path === resolved)) return match;
    return `![${alt}](<${trimmed}>)`;
  });
}

export function MarkdownPreview({
  markdown,
  baseDir,
  files,
  manifest,
  onEditDrawing,
}: Props) {
  const components: Components = {
    img({ src = "", alt = "", ...props }) {
      const resolved = resolvePackagePath(baseDir, decodePackageUrl(src));
      const file = resolved ? files.find((candidate) => candidate.path === resolved) : undefined;
      if (file?.base64) {
        return <img
          {...props}
          src={`data:${imageMediaType(file.path)};base64,${file.base64}`}
          alt={alt}
        />;
      }
      if (file?.is_text && file.content?.trim().startsWith("<svg")) {
        const resource = manifest ? findResourceByRendered(manifest, resolved ?? "") : undefined;
        return <span
          className="drawing-image"
          data-drawpath={resource?.source ?? ""}
          role={resource?.source && onEditDrawing ? "button" : undefined}
          tabIndex={resource?.source && onEditDrawing ? 0 : undefined}
          onClick={() => {
            if (resource?.source) onEditDrawing?.(resource.source);
          }}
          onKeyDown={(event) => {
            if (resource?.source && (event.key === "Enter" || event.key === " ")) {
              event.preventDefault();
              onEditDrawing?.(resource.source);
            }
          }}
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(file.content) }}
        />;
      }
      return <span className="missing-image">⚠️ 画像が見つかりません: {src}</span>;
    },
    a({ href = "", ...props }) {
      return <a {...props} href={packageUrl(baseDir, href)} />;
    },
  };
  const urlTransform: UrlTransform = (url, key) =>
    key === "href" ? packageUrl(baseDir, url) : url;
  const compatibleMarkdown = normalizeLegacyImageDestinations(markdown, baseDir, files);

  return <div className="markdown-preview">
    <ReactMarkdown
      components={components}
      remarkPlugins={[remarkGfm]}
      urlTransform={urlTransform}
    >
      {compatibleMarkdown}
    </ReactMarkdown>
  </div>;
}
