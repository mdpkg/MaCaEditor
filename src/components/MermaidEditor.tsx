import { useEffect, useState } from "react";
import { renderMermaid } from "../lib/mermaid/renderer";
import { sanitizeHtml } from "../lib/sanitize";
import { CodeEditor } from "./CodeEditor";
import { SvgPreviewOverlay } from "./SvgPreviewOverlay";

interface Props {
  source: string;
  initialSvg: string;
  onSourceChange: (source: string) => void;
  onRendered: (source: string, svg: string) => void;
  render?: (source: string) => Promise<string>;
  vimMode?: boolean;
  onSave?: () => void | Promise<void>;
  onAiEdit?: () => void;
}

export function MermaidEditor({
  source, initialSvg, onSourceChange, onRendered, render = renderMermaid, vimMode = false, onSave, onAiEdit,
}: Props) {
  const [svg, setSvg] = useState(initialSvg);
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const sanitizedSvg = sanitizeHtml(svg);

  useEffect(() => {
    let active = true;
    const timeout = window.setTimeout(() => {
      setRendering(true);
      setError(null);
      void render(source).then((nextSvg) => {
        if (!active) return;
        setSvg(nextSvg);
        setRendering(false);
        onRendered(source, nextSvg);
      }).catch((reason) => {
        if (!active) return;
        setError(String(reason));
        setRendering(false);
      });
    }, 350);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [source, render, onRendered]);

  return (
    <div className="mermaid-editor">
      <div className="mermaid-source-pane">
        <div className="diagram-pane-title">Mermaid {onAiEdit && <button type="button" onClick={onAiEdit}>AI Edit</button>}</div>
        <CodeEditor
          className="mermaid-source"
          value={source}
          onChange={onSourceChange}
          vimMode={vimMode}
          onSave={onSave}
          ariaLabel="Mermaid source"
        />
      </div>
      <div className="mermaid-preview-pane">
        <div className="diagram-pane-title">Preview{rendering ? " — Rendering…" : ""}</div>
        {error && <div className="diagram-render-error" role="alert">{error}</div>}
        {!error && svg && (
          <div
            className="mermaid-preview"
            role="button"
            tabIndex={0}
            title="クリックで拡大表示"
            onClick={() => setPreviewOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setPreviewOpen(true);
              }
            }}
            dangerouslySetInnerHTML={{ __html: sanitizedSvg }}
          />
        )}
      </div>
      {previewOpen && (
        <SvgPreviewOverlay svg={sanitizedSvg} label="Mermaidダイアグラム" onClose={() => setPreviewOpen(false)} />
      )}
    </div>
  );
}
