import ReactMarkdown from "react-markdown";
import type { Components, UrlTransform } from "react-markdown";
import type {
  ComponentProps,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import remarkGfm from "remark-gfm";
import remarkToc from "remark-toc";
import type { FileInfo } from "../types";
import { resolvePackagePath } from "../lib/markdown";
import { sanitizeHtml } from "../lib/sanitize";
import { findResourceByRendered } from "../lib/drawing/docIntegration";
import { imageMediaType } from "../lib/document";
import { findPlantUmlResourceByRendered } from "../lib/plantuml/docIntegration";
import { findMermaidResourceByRendered } from "../lib/mermaid/docIntegration";
import { findMathJaxResourceByRendered } from "../lib/mathjax/docIntegration";
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
  onEditMathJax?: (sourcePath: string) => void;
  onEditTable?: (start: number, end: number) => void;
  onDownloadAttachment?: (file: FileInfo) => void;
  showToc?: boolean;
  rspressMode?: boolean;
}

type PreviewMedia =
  | { kind: "image"; src: string; alt: string }
  | {
      kind: "diagram";
      html: string;
      alt: string;
      onEdit?: () => void;
      whiteBackground?: boolean;
    };

interface MediaTransform {
  scale: number;
  x: number;
  y: number;
}

const initialMediaTransform: MediaTransform = { scale: 1, x: 0, y: 0 };

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

function attachmentDataUrl(file: FileInfo): string {
  if (file.base64 !== null) {
    return `data:application/octet-stream;base64,${file.base64}`;
  }
  return `data:text/plain;charset=utf-8,${encodeURIComponent(file.content ?? "")}`;
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
  onEditMathJax,
  onEditTable,
  onDownloadAttachment,
  showToc = false,
  rspressMode = false,
}: Props) {
  const [previewMedia, setPreviewMedia] = useState<PreviewMedia | null>(null);
  const [mediaTransform, setMediaTransform] = useState(initialMediaTransform);
  const [draggingMedia, setDraggingMedia] = useState(false);
  const diagramClickTimer = useRef<number | null>(null);
  const mediaDrag = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const showPreviewMedia = (media: PreviewMedia) => {
    setMediaTransform(initialMediaTransform);
    setPreviewMedia(media);
  };

  const cancelDiagramClick = () => {
    if (diagramClickTimer.current !== null) {
      window.clearTimeout(diagramClickTimer.current);
      diagramClickTimer.current = null;
    }
  };

  const showDiagramAfterDoubleClickDelay = (media: PreviewMedia) => {
    cancelDiagramClick();
    diagramClickTimer.current = window.setTimeout(() => {
      showPreviewMedia(media);
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

  const zoomPreviewMedia = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const centerX = rect.width > 0 ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const centerY = rect.height > 0 ? rect.top + rect.height / 2 : window.innerHeight / 2;
    setMediaTransform((current) => {
      const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
      const scale = Math.min(8, Math.max(0.2, Number((current.scale * factor).toFixed(4))));
      const imageX = (event.clientX - centerX - current.x) / current.scale;
      const imageY = (event.clientY - centerY - current.y) / current.scale;
      return {
        scale,
        x: event.clientX - centerX - imageX * scale,
        y: event.clientY - centerY - imageY * scale,
      };
    });
  };

  const startMediaDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    mediaDrag.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: mediaTransform.x,
      originY: mediaTransform.y,
    };
    setDraggingMedia(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const moveMediaDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = mediaDrag.current;
    if (!drag) return;
    setMediaTransform((current) => ({
      ...current,
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    }));
  };

  const stopMediaDrag = () => {
    mediaDrag.current = null;
    setDraggingMedia(false);
  };

  const editEnlargedDiagram = () => {
    if (previewMedia?.kind !== "diagram" || !previewMedia.onEdit) return;
    setPreviewMedia(null);
    previewMedia.onEdit();
  };

  const components: Components = {
    ...Object.fromEntries(([1, 2, 3, 4, 5, 6] as const).map((level) => {
      const Tag = `h${level}` as const;
      return [Tag, ({ node, ...props }: ComponentProps<typeof Tag> & { node?: { position?: { start: { offset?: number } } } }) => {
        const previewOffset = node?.position?.start.offset;
        const tocPrefixLength = showToc ? "## 目次\n\n".length : 0;
        const sourceOffset = previewOffset === undefined || previewOffset < tocPrefixLength
          ? undefined
          : previewOffset - tocPrefixLength;
        return <Tag {...props} data-source-offset={sourceOffset} />;
      }];
    })),
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
          onClick={() => showPreviewMedia({ kind: "image", src: imageSrc, alt })}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              showPreviewMedia({ kind: "image", src: imageSrc, alt });
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
        const mathJaxResource = manifest
          ? findMathJaxResourceByRendered(manifest, resolved ?? "")
          : undefined;
        const sourcePath = drawingResource?.source ?? plantUmlResource?.source ?? mermaidResource?.source ?? mathJaxResource?.source;
        const editDiagram = drawingResource
          ? onEditDrawing
          : plantUmlResource ? onEditPlantUml : mermaidResource ? onEditMermaid : onEditMathJax;
        return <span
          className="drawing-image preview-diagram"
          data-drawpath={sourcePath ?? ""}
          role={sourcePath && editDiagram ? "button" : undefined}
          tabIndex={sourcePath && editDiagram ? 0 : undefined}
          title={sourcePath && editDiagram
            ? "クリックで拡大、ダブルクリックでダイアグラムを編集"
            : "クリックで拡大表示"}
          onClick={() => showDiagramAfterDoubleClickDelay({
            kind: "diagram",
            html: sanitizedSvg,
            alt,
            onEdit: sourcePath && editDiagram
              ? () => editDiagram(sourcePath)
              : undefined,
            whiteBackground: plantUmlResource !== undefined || mermaidResource !== undefined || mathJaxResource !== undefined,
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
        >
          <span
            className="preview-diagram-content"
            dangerouslySetInnerHTML={{ __html: sanitizedSvg }}
          />
          {sourcePath && editDiagram && (
            <button
              type="button"
              className="preview-diagram-edit"
              onClick={(event) => {
                event.stopPropagation();
                cancelDiagramClick();
                editDiagram(sourcePath);
              }}
              onDoubleClick={(event) => event.stopPropagation()}
            >Edit</button>
          )}
        </span>;
      }
      return <span className="missing-image">⚠️ 画像が見つかりません: {src}</span>;
    },
    a({ href = "", ...props }) {
      const packagePath = decodePackageUrl(href);
      const attachment = files.find((file) =>
        file.path === packagePath && file.path.startsWith("attachments/"));
      if (attachment) {
        const fileName = attachment.path.slice(attachment.path.lastIndexOf("/") + 1);
        return <a
          {...props}
          href={attachmentDataUrl(attachment)}
          download={fileName}
          title="クリックしてダウンロード"
          onClick={(event) => {
            if (!onDownloadAttachment) return;
            event.preventDefault();
            onDownloadAttachment(attachment);
          }}
        />;
      }
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

  return <>
    <div className="markdown-preview">
      <ReactMarkdown
        components={components}
        remarkPlugins={remarkPlugins}
        urlTransform={urlTransform}
      >
        {previewMarkdown}
      </ReactMarkdown>
    </div>
    {previewMedia && createPortal(
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
        <div
          className={`preview-media-content${draggingMedia ? " dragging" : ""}`}
          onWheel={zoomPreviewMedia}
          onPointerDown={startMediaDrag}
          onPointerMove={moveMediaDrag}
          onPointerUp={stopMediaDrag}
          onPointerCancel={stopMediaDrag}
          onDoubleClick={editEnlargedDiagram}
        >
          <div
            className="preview-media-transform"
            style={{
              transform: `translate(${mediaTransform.x}px, ${mediaTransform.y}px) scale(${mediaTransform.scale})`,
            }}
          >
            {previewMedia.kind === "image" ? (
              <img src={previewMedia.src} alt={previewMedia.alt} draggable={false} />
            ) : (
              <span
                className={`drawing-image${previewMedia.whiteBackground
                  ? " preview-media-white-background"
                  : ""}`}
                role="img"
                aria-label={previewMedia.alt || "ダイアグラム"}
                title={previewMedia.onEdit ? "ダブルクリックでダイアグラムを編集" : undefined}
                dangerouslySetInnerHTML={{ __html: previewMedia.html }}
              />
            )}
          </div>
        </div>
      </div>,
      document.body,
    )}
  </>;
}
