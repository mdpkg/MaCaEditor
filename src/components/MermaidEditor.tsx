import { useEffect, useState } from "react";
import { renderMermaid } from "../lib/mermaid/renderer";
import { sanitizeHtml } from "../lib/sanitize";
import { CodeEditor } from "./CodeEditor";

interface Props {
  source: string;
  initialSvg: string;
  onSourceChange: (source: string) => void;
  onRendered: (source: string, svg: string) => void;
  render?: (source: string) => Promise<string>;
  vimMode?: boolean;
}

export function MermaidEditor({
  source, initialSvg, onSourceChange, onRendered, render = renderMermaid, vimMode = false,
}: Props) {
  const [svg, setSvg] = useState(initialSvg);
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);

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
        <div className="diagram-pane-title">Mermaid</div>
        <CodeEditor
          className="mermaid-source"
          value={source}
          onChange={onSourceChange}
          vimMode={vimMode}
          ariaLabel="Mermaid source"
        />
      </div>
      <div className="mermaid-preview-pane">
        <div className="diagram-pane-title">Preview{rendering ? " — Rendering…" : ""}</div>
        {error && <div className="diagram-render-error" role="alert">{error}</div>}
        {!error && svg && (
          <div
            className="mermaid-preview"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(svg) }}
          />
        )}
      </div>
    </div>
  );
}
