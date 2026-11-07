import { uiText } from "../lib/uiText";
import { Dialog } from "./Dialog";
import { DiagramRenderError } from "./DiagramRenderError";
import ReactMarkdown from "react-markdown";
import type { Components, UrlTransform } from "react-markdown";
import type {
  ComponentProps,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import type { FileInfo } from "../types";
import { resolvePackagePath } from "../lib/markdown";
import { sanitizeHtml } from "../lib/sanitize";
import { findResourceByRendered } from "../lib/drawing/docIntegration";
import { imageMediaType } from "../lib/document";
import { findPlantUmlResourceByRendered } from "../lib/plantuml/docIntegration";
import { plantUmlErrorDetail } from "../lib/plantuml/renderer";
import { findMermaidResourceByRendered } from "../lib/mermaid/docIntegration";
import { findMathJaxResourceByRendered } from "../lib/mathjax/docIntegration";
import { mathJaxErrorDetail } from "../lib/mathjax/renderer";
import { remarkGitHubAlerts } from "../lib/remarkGitHubAlerts";
import { remarkRspressContainers } from "../lib/remarkRspressContainers";
import { remarkFrontmatterTable } from "../lib/remarkFrontmatterTable";

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
  onNavigateMarkdown?: (path: string) => void;
  showToc?: boolean;
  rspressMode?: boolean;
  scrollRestoreKey?: string;
  initialScrollRatio?: number;
  restoreScroll?: boolean;
  onScrollRatioChange?: (ratio: number) => void;
}

type PreviewMedia =
  | { kind: "image"; src: string; alt: string }
  | {
      kind: "diagram";
      html: string;
      alt: string;
      onEdit?: () => void;
      whiteBackground?: boolean;
    }
  | { kind: "diagram-error"; detail: string; onEdit?: () => void };

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
  onNavigateMarkdown,
  showToc = false,
  rspressMode = false,
  scrollRestoreKey,
  initialScrollRatio = 0,
  restoreScroll = true,
  onScrollRatioChange,
}: Props) {
  const tocPrefixLength = 0;
  const [previewMedia, setPreviewMedia] = useState<PreviewMedia | null>(null);
  const [mediaTransform, setMediaTransform] = useState(initialMediaTransform);
  const [draggingMedia, setDraggingMedia] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const mediaDrag = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const showPreviewMedia = useCallback((media: PreviewMedia) => {
    setMediaTransform(initialMediaTransform);
    setPreviewMedia(media);
  }, []);

  useEffect(() => {
    const preview = previewRef.current;
    if (!preview || !restoreScroll) return;
    const frame = requestAnimationFrame(() => {
      const maximum = Math.max(0, preview.scrollHeight - preview.clientHeight);
      preview.scrollTop = maximum * Math.max(0, Math.min(1, initialScrollRatio));
      // Let the split view synchronize its editor after the preview is restored.
      preview.dispatchEvent(new Event("scroll"));
    });
    return () => cancelAnimationFrame(frame);
  }, [scrollRestoreKey]);

  const reportScrollRatio = () => {
    const preview = previewRef.current;
    if (!preview || !onScrollRatioChange) return;
    const maximum = Math.max(0, preview.scrollHeight - preview.clientHeight);
    onScrollRatioChange(maximum > 0 ? preview.scrollTop / maximum : 0);
  };

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
    if (!previewMedia || previewMedia.kind === "image" || !previewMedia.onEdit) return;
    setPreviewMedia(null);
    previewMedia.onEdit();
  };

  const actions = {
    onEditDrawing, onEditPlantUml, onEditMermaid, onEditMathJax,
    onEditTable, onDownloadAttachment, onNavigateMarkdown,
  };
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  // Keep the media opener mounted when the overlay or app controls re-render.
  const components = useMemo<Components>(() => ({
    ...Object.fromEntries(([1, 2, 3, 4, 5, 6] as const).map((level) => {
      const Tag = `h${level}` as const;
      return [Tag, ({ node, ...props }: ComponentProps<typeof Tag> & { node?: { position?: { start: { offset?: number } } } }) => {
        const previewOffset = node?.position?.start.offset;
        const sourceOffset = previewOffset === undefined || previewOffset < tocPrefixLength
          ? undefined
          : previewOffset - tocPrefixLength;
        return <Tag {...props} data-source-offset={sourceOffset} />;
      }];
    })),
    table({ node, ...props }) {
      const { onEditTable } = actionsRef.current;
      const previewStart = node?.position?.start.offset;
      const previewEnd = node?.position?.end.offset;
      const start = previewStart === undefined || previewStart < tocPrefixLength
        ? undefined
        : previewStart - tocPrefixLength;
      const end = previewEnd === undefined || previewEnd < tocPrefixLength
        ? undefined
        : previewEnd - tocPrefixLength;
      const editable = Boolean(onEditTable && start !== undefined && end !== undefined);
      return <table
        {...props}
        className={[props.className, editable ? "editable-markdown-table" : ""].filter(Boolean).join(" ") || undefined}
        role={editable ? "button" : undefined}
        tabIndex={editable ? 0 : undefined}
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
          title={uiText("Click to enlarge")}
          onClick={(event) => {
            event.currentTarget.focus();
            showPreviewMedia({ kind: "image", src: imageSrc, alt });
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              showPreviewMedia({ kind: "image", src: imageSrc, alt });
            }
          }}
        />;
      }
      if (file?.is_text && file.content?.trim().startsWith("<svg")) {
        const { onEditDrawing, onEditPlantUml, onEditMermaid, onEditMathJax } = actionsRef.current;
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
        const onEdit = sourcePath && editDiagram ? () => editDiagram(sourcePath) : undefined;
        const detail = plantUmlResource
          ? plantUmlErrorDetail(file.content)
          : mathJaxResource
            ? mathJaxErrorDetail(new DOMParser().parseFromString(file.content, "text/html"))
            : null;
        if (detail) {
          return <span className="preview-diagram preview-diagram-error" data-drawpath={sourcePath ?? ""}
            onClick={(event) => {
              if (event.target instanceof Element && event.target.closest("button")) {
                event.preventDefault();
                event.stopPropagation();
              }
            }}>
            <DiagramRenderError detail={detail} inline />
            <button type="button" aria-label={alt ? `${uiText("Enlarge diagram")}（${alt}）` : undefined}
              onClick={(event) => {
                event.currentTarget.focus();
                showPreviewMedia({ kind: "diagram-error", detail, onEdit });
              }}>{uiText("Enlarge diagram")}</button>
            {onEdit && <button type="button" onClick={onEdit}>{uiText("Edit")}</button>}
          </span>;
        }
        const sanitizedSvg = sanitizeHtml(file.content);
        const media: PreviewMedia = {
          kind: "diagram", html: sanitizedSvg, alt,
          onEdit,
          whiteBackground: true,
        };
        return <span
          className="drawing-image preview-diagram"
          data-drawpath={sourcePath ?? ""}
        >
          <span
            className="preview-diagram-content"
            role="button"
            tabIndex={0}
            aria-label={alt || uiText("Enlarge diagram")}
            title={uiText("Click to enlarge")}
            onClick={(event) => {
              event.currentTarget.focus();
              showPreviewMedia(media);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                showPreviewMedia(media);
              }
            }}
            dangerouslySetInnerHTML={{ __html: sanitizedSvg }}
          />
          {sourcePath && editDiagram && (
            <button
              type="button"
              className="preview-diagram-edit"
              onClick={() => editDiagram(sourcePath)}
            >{uiText("Edit")}</button>
          )}
        </span>;
      }
      return <span className="missing-image">⚠️ 画像が見つかりません: {src}</span>;
    },
    a({ href = "", ...props }) {
      const { onDownloadAttachment, onNavigateMarkdown } = actionsRef.current;
      const packagePath = decodePackageUrl(href);
      const resolvedPath = files.some((file) => file.path === packagePath)
        ? packagePath
        : resolvePackagePath(baseDir, packagePath);
      const attachment = files.find((file) => file.path === resolvedPath &&
        /(^|\/)attachments\//.test(file.path));
      if (attachment) {
        const fileName = attachment.path.slice(attachment.path.lastIndexOf("/") + 1);
        return <a
          {...props}
          href={attachmentDataUrl(attachment)}
          download={fileName}
          title={uiText("Click to download")}
          onClick={(event) => {
            if (!onDownloadAttachment) return;
            event.preventDefault();
            onDownloadAttachment(attachment);
          }}
        />;
      }
      const markdown = files.find((file) => file.path === resolvedPath && /\.(md|markdown)$/i.test(file.path));
      if (markdown) {
        return <a {...props} href={markdown.path} onClick={(event) => {
          if (!onNavigateMarkdown) return;
          event.preventDefault();
          onNavigateMarkdown(markdown.path);
        }} />;
      }
      return <a {...props} href={packageUrl(baseDir, href)} />;
    },
  }), [
    baseDir, files, manifest, tocPrefixLength, showPreviewMedia,
  ]);
  const urlTransform: UrlTransform = (url, key) =>
    key === "href" ? packageUrl(baseDir, url) : url;
  const compatibleMarkdown = normalizeLegacyImageDestinations(markdown, baseDir, files);
  const previewMarkdown = compatibleMarkdown;
  const remarkPlugins: NonNullable<ComponentProps<typeof ReactMarkdown>["remarkPlugins"]> = [
    remarkFrontmatter,
    remarkGfm,
    ...(rspressMode ? [remarkRspressContainers] : []),
    remarkGitHubAlerts,
    [remarkFrontmatterTable, { showToc }],
  ];

  return <>
    <div ref={previewRef} className="markdown-preview" onScroll={reportScrollRatio}>
      <ReactMarkdown
        components={components}
        remarkPlugins={remarkPlugins}
        urlTransform={urlTransform}
      >
        {previewMarkdown}
      </ReactMarkdown>
    </div>
    {previewMedia && createPortal(
      <Dialog className="preview-media-overlay" title={uiText("Enlarged preview")} onClose={() => setPreviewMedia(null)} backdrop={false}>
        <button
          type="button"
          className="preview-media-close"
          aria-label={uiText("Close enlarged preview")}
          onClick={() => setPreviewMedia(null)}
        >×</button>
        {previewMedia.kind !== "image" && previewMedia.onEdit && <button className="preview-media-edit" onClick={editEnlargedDiagram}>{uiText("Edit")}</button>}
        {previewMedia.kind === "diagram-error" ? (
          <div className="preview-media-error"><DiagramRenderError detail={previewMedia.detail} /></div>
        ) : <div
          className={`preview-media-content${draggingMedia ? " dragging" : ""}`}
          onWheel={zoomPreviewMedia}
          onPointerDown={startMediaDrag}
          onPointerMove={moveMediaDrag}
          onPointerUp={stopMediaDrag}
          onPointerCancel={stopMediaDrag}
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
                aria-label={previewMedia.alt || uiText("Diagram")}
                dangerouslySetInnerHTML={{ __html: previewMedia.html }}
              />
            )}
          </div>
        </div>}
      </Dialog>,
      document.body,
    )}
  </>;
}
