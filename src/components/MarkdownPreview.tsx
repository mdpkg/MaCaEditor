import { useMemo } from "react";
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderInline(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

export function MarkdownPreview({
  markdown,
  baseDir,
  files,
  manifest,
  onEditDrawing,
}: Props) {
  const html = useMemo(() => {
    const lines = markdown.split("\n");
    let out = "";
    let inCode = false;

    for (const line of lines) {
      if (line.startsWith("```")) {
        out += inCode ? "</code></pre>" : "<pre><code>";
        inCode = !inCode;
        continue;
      }
      if (inCode) {
        out += escapeHtml(line) + "\n";
        continue;
      }

      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        const level = heading[1].length;
        out += `<h${level}>${renderInline(heading[2])}</h${level}>\n`;
        continue;
      }

      const image = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
      if (image) {
        const resolved = resolvePackagePath(baseDir, image[2]);
        const file = resolved
          ? files.find((f) => f.path === resolved)
          : undefined;
        const resource = manifest
          ? findResourceByRendered(manifest, resolved ?? "")
          : undefined;
        if (file && file.base64) {
          out += `<img src="data:${imageMediaType(file.path)};base64,${file.base64}" alt="${image[1]}" />\n`;
        } else if (file && file.is_text && file.content?.trim().startsWith("<svg")) {
          out += `<div class="drawing-image" data-drawpath="${resource?.source ?? ""}">${file.content}</div>\n`;
        } else {
          out += `<p>⚠️ 画像が見つかりません: ${image[2]}</p>\n`;
        }
        continue;
      }

      const link = line.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (link) {
        const resolved = resolvePackagePath(baseDir, link[2]);
        out += `<p><a href="${resolved ?? "#"}">${link[1]}</a></p>\n`;
        continue;
      }

      const list = line.match(/^\s*[-*]\s+(.*)$/);
      if (list) {
        out += `<ul><li>${renderInline(list[1])}</li></ul>\n`;
        continue;
      }

      const ordered = line.match(/^\s*\d+\.\s+(.*)$/);
      if (ordered) {
        out += `<ol><li>${renderInline(ordered[1])}</li></ol>\n`;
        continue;
      }

      const quote = line.match(/^>\s+(.*)$/);
      if (quote) {
        out += `<blockquote>${renderInline(quote[1])}</blockquote>\n`;
        continue;
      }

      const table = line.match(/^\|(.+)\|$/);
      if (table) {
        const cells = table[1]
          .split("|")
          .map((c) => c.trim())
          .filter((c) => c.length > 0);
        out += `<table><tr>${cells.map((c) => `<td>${renderInline(c)}</td>`).join("")}</tr></table>\n`;
        continue;
      }

      if (line.trim() === "---") {
        out += "<hr />\n";
        continue;
      }

      if (line.trim() === "") {
        continue;
      }

      out += `<p>${renderInline(line)}</p>\n`;
    }

    if (inCode) {
      out += "</code></pre>";
    }

    return sanitizeHtml(out);
  }, [markdown, baseDir, files, manifest]);

  return (
    <div
      className="markdown-preview"
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        if (!onEditDrawing) return;
        const target = (e.target as HTMLElement).closest(".drawing-image");
        if (target) {
          const drawPath = target.getAttribute("data-drawpath");
          if (drawPath) {
            e.preventDefault();
            onEditDrawing(drawPath);
          }
        }
      }}
    />
  );
}
