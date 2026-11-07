import { uiText } from "../lib/uiText";
import { useEffect, useState } from "react";
import { sanitizeHtml } from "../lib/sanitize";
import { mathJaxErrorDetail, renderMathJax } from "../lib/mathjax/renderer";
import { CodeEditor } from "./CodeEditor";
import { SvgPreviewOverlay } from "./SvgPreviewOverlay";
import { DiagramRenderError } from "./DiagramRenderError";

interface Props {
  source: string;
  initialSvg: string;
  onSourceChange: (source: string) => void;
  onRendered: (source: string, svg: string) => void;
  render?: (source: string) => Promise<string>;
  vimMode?: boolean;
  onSave?: () => void | Promise<void>;
}

export function MathJaxEditor({
  source, initialSvg, onSourceChange, onRendered, render = renderMathJax, vimMode = false, onSave,
}: Props) {
  const [svg, setSvg] = useState(() => {
    if (!initialSvg) return "";
    const parsed = new DOMParser().parseFromString(initialSvg, "text/html");
    return mathJaxErrorDetail(parsed) ? "" : initialSvg;
  });
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
    return () => { active = false; window.clearTimeout(timeout); };
  }, [source, render, onRendered]);

  return <div className="mathjax-editor">
    <div className="mathjax-source-pane">
      <div className="diagram-pane-title">MathJax (TeX)</div>
      <CodeEditor className="mathjax-source" value={source} onChange={onSourceChange}
        vimMode={vimMode} onSave={onSave} ariaLabel="MathJax source" />
    </div>
    <div className="mathjax-preview-pane">
      <div className="diagram-pane-title">{uiText("Preview")}{rendering && ` — ${uiText("Rendering…")}`}</div>
      {error && <DiagramRenderError detail={error} />}
      {!error && svg && <div className="mathjax-preview" role="button" tabIndex={0}
        title={uiText("Click to enlarge")} onClick={() => setPreviewOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault(); setPreviewOpen(true);
          }
        }} dangerouslySetInnerHTML={{ __html: sanitizedSvg }} />}
    </div>
    {previewOpen && <SvgPreviewOverlay
      svg={sanitizedSvg}
      label={uiText("Math expression")}
      whiteBackground
      onClose={() => setPreviewOpen(false)}
    />}
  </div>;
}
