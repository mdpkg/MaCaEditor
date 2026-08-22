import ReactMarkdown from "react-markdown";
import type { Components, UrlTransform } from "react-markdown";
import type { ComponentProps } from "react";
import { useEffect, useRef, useState } from "react";
import remarkGfm from "remark-gfm";
import remarkToc from "remark-toc";
import type { FileInfo } from "../types";
import { resolvePackagePath } from "../lib/markdown";
import { sanitizeHtml } from "../lib/sanitize";
import { findResourceByRendered } from "../lib/drawing/docIntegration";
import { imageMediaType } from "../lib/document";
import { findPlantUmlResourceByRendered } from "../lib/plantuml/docIntegration";
import { findMermaidResourceByRendered } from "../lib/mermaid/docIntegration";
import { remarkGitHubAlerts } from "../lib/remarkGitHubAlerts";
import { remarkRspressContainers } from "../lib/remarkRspressContainers";

interface Props {
  markdown: string;
  baseDir: string;
  files: FileInfo[];
  manifest?: Record<string, unknown>;
  onEditDrawing?: (drawPath: string) => void;
  onEditPlantUml?: (sourcePath: string) => void;
  onEditMermaid?: (sourcePath: string) => void;
  onEditTable?: (start: number, end: number) => void;
  showToc?: boolean;
  rspressMode?: boolean;
}

type PreviewMedia =
  | { kind: "image"; src: string; alt: string }
  | { kind: "diagram"; html: string; alt: string };

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
  onEditPlantUml,
  onEditMermaid,
  onEditTable,
  showToc = false,
  rspressMode = false,
}: Props) {
  const [previewMedia, setPreviewMedia] = useState<PreviewMedia | null>(null);
  const diagramClickTimer = useRef<number | null>(null);

  const cancelDiagramClick = () => {
    if (diagramClickTimer.current !== null) {
      window.clearTimeout(diagramClickTimer.current);
      diagramClickTimer.current = null;
    }
  };

  const showDiagramAfterDoubleClickDelay = (media: PreviewMedia) => {
    cancelDiagramClick();
    diagramClickTimer.current = window.setTimeout(() => {
      setPreviewMedia(media);
      diagramClickTimer.current = null;
    }, 200);
  };

  useEffect(() => () => cancelDiagramClick(), []);

  useEffect(() => {
    if (!previewMedia) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewMedia(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [previewMedia]);

  const components: Components = {
    table({ node, ...props }) {
      const start = node?.position?.start.offset;
      const end = node?.position?.end.offset;
      return <table
        {...props}
        className={onEditTable ? "editable-markdown-table" : undefined}
        role={onEditTable ? "button" : undefined}
        tabIndex={onEditTable ? 0 : undefined}
        onClick={() => {
          if (start !== undefined && end !== undefined) onEditTable?.(start, end);
        }}
        onKeyDown={(event) => {
          if ((event.key === "Enter" || event.key === " ") && start !== undefined && end !== undefined) {
            event.preventDefault();
            onEditTable?.(start, end);
          }
        }}
      />;
    },
    img({ src = "", alt = "", ...props }) {
      const resolved = resolvePackagePath(baseDir, decodePackageUrl(src));
      const file = resolved ? files.find((candidate) => candidate.path === resolved) : undefined;
      if (file?.base64) {
        const imageSrc = `data:${imageMediaType(file.path)};base64,${file.base64}`;
        return <img
          {...props}
          src={imageSrc}
          alt={alt}
          role="button"
          tabIndex={0}
          title="クリックで拡大表示"
          onClick={() => setPreviewMedia({ kind: "image", src: imageSrc, alt })}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setPreviewMedia({ kind: "image", src: imageSrc, alt });
            }
          }}
        />;
      }
      if (file?.is_text && file.content?.trim().startsWith("<svg")) {
        const sanitizedSvg = sanitizeHtml(file.content);
        const drawingResource = manifest ? findResourceByRendered(manifest, resolved ?? "") : undefined;
        const plantUmlResource = manifest
          ? findPlantUmlResourceByRendered(manifest, resolved ?? "")
          : undefined;
        const mermaidResource = manifest
          ? findMermaidResourceByRendered(manifest, resolved ?? "")
          : undefined;
        const sourcePath = drawingResource?.source ?? plantUmlResource?.source ?? mermaidResource?.source;
        const editDiagram = drawingResource
          ? onEditDrawing
          : plantUmlResource ? onEditPlantUml : onEditMermaid;
        return <span
          className="drawing-image"
          data-drawpath={sourcePath ?? ""}
          role={sourcePath && editDiagram ? "button" : undefined}
          tabIndex={sourcePath && editDiagram ? 0 : undefined}
          title={sourcePath && editDiagram
            ? "クリックで拡大、ダブルクリックでダイアグラムを編集"
            : "クリックで拡大表示"}
          onClick={() => showDiagramAfterDoubleClickDelay({
            kind: "diagram", html: sanitizedSvg, alt,
          })}
          onDoubleClick={() => {
            cancelDiagramClick();
            if (sourcePath) editDiagram?.(sourcePath);
          }}
          onKeyDown={(event) => {
            if (sourcePath && (event.key === "Enter" || event.key === " ")) {
              event.preventDefault();
              editDiagram?.(sourcePath);
            }
          }}
          dangerouslySetInnerHTML={{ __html: sanitizedSvg }}
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
  const previewMarkdown = showToc
    ? `## 目次\n\n${compatibleMarkdown}`
    : compatibleMarkdown;
  const remarkPlugins: NonNullable<ComponentProps<typeof ReactMarkdown>["remarkPlugins"]> = [
    remarkGfm,
    ...(rspressMode ? [remarkRspressContainers] : []),
    remarkGitHubAlerts,
    [remarkToc, { heading: "目次" }],
  ];

  return <div className="markdown-preview">
    <ReactMarkdown
      components={components}
      remarkPlugins={remarkPlugins}
      urlTransform={urlTransform}
    >
      {previewMarkdown}
    </ReactMarkdown>
    {previewMedia && (
      <div
        className="preview-media-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="拡大表示"
      >
        <button
          type="button"
          className="preview-media-close"
          aria-label="拡大表示を閉じる"
          onClick={() => setPreviewMedia(null)}
        >×</button>
        <div className="preview-media-content">
          {previewMedia.kind === "image" ? (
            <img src={previewMedia.src} alt={previewMedia.alt} />
          ) : (
            <span
              className="drawing-image"
              role="img"
              aria-label={previewMedia.alt || "ダイアグラム"}
              dangerouslySetInnerHTML={{ __html: previewMedia.html }}
            />
          )}
        </div>
      </div>
    )}
  </div>;
}
