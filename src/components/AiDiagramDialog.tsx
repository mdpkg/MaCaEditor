import { useEffect, useRef, useState } from "react";
import type { AiConfig } from "../types";
import { AiDiagramGenerationService, type DiagramFormat, type DiagramIntent, type GeneratedDiagram } from "../lib/aiDiagram";
import { aiErrorMessage, isAiConfigured, type AiErrorKind } from "../lib/aiSelection";
import { loadAiConfig } from "../lib/tauri";
import { renderPlantUml } from "../lib/plantuml/renderer";
import { renderMermaid } from "../lib/mermaid/renderer";
import { sanitizeHtml } from "../lib/sanitize";

interface Props {
  markdown: string; sourceLabel: "Selected text" | "Current document";
  onConfirm: (diagram: GeneratedDiagram, svg: string) => void;
  onClose: () => void; onOpenAiSettings: () => void;
}

export function AiDiagramDialog({ markdown, sourceLabel, onConfirm, onClose, onOpenAiSettings }: Props) {
  const serviceRef = useRef(new AiDiagramGenerationService());
  const service = serviceRef.current;
  const [stream, setStream] = useState(service.getState());
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [format, setFormat] = useState<DiagramFormat>("plantuml");
  const [intent, setIntent] = useState<DiagramIntent>("auto");
  const [source, setSource] = useState("");
  const [svg, setSvg] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => service.subscribe(() => setStream(service.getState())), [service]);
  useEffect(() => { void loadAiConfig().then(setConfig).catch(() => setConfig(null)); }, []);
  useEffect(() => () => { void service.cancel(); }, [service]);
  useEffect(() => {
    if (stream.status !== "completed") return;
    setSource(stream.result);
    setSvg(""); setValidationError(null);
    const render = format === "plantuml" ? renderPlantUml : renderMermaid;
    void render(stream.result).then(setSvg).catch((reason) => setValidationError(String(reason)));
  }, [stream.status, stream.result, format]);

  const validate = async () => {
    setSvg(""); setValidationError(null);
    try { setSvg(await (format === "plantuml" ? renderPlantUml(source) : renderMermaid(source))); }
    catch (reason) { setValidationError(String(reason)); }
  };
  const close = async () => { await service.cancel(); onClose(); };
  const configured = config !== null && isAiConfigured(config);
  const aiError = stream.errorKind ? aiErrorMessage(stream.errorKind as AiErrorKind) : null;
  return <div className="about-dialog-backdrop" onPointerDown={() => void close()}>
    <section className="about-dialog ai-result-dialog ai-diagram-dialog" role="dialog" aria-modal="true" aria-label="Generate Diagram" onPointerDown={(e) => e.stopPropagation()}>
      <h2>Generate Diagram</h2>
      <p>Source: <strong>{sourceLabel}</strong></p>
      <label>Format <select aria-label="Diagram format" value={format} disabled={stream.status === "running"} onChange={(e) => setFormat(e.target.value as DiagramFormat)}><option value="plantuml">PlantUML</option><option value="mermaid">Mermaid</option></select></label>
      <label> Intent <select aria-label="Diagram intent" value={intent} disabled={stream.status === "running"} onChange={(e) => setIntent(e.target.value as DiagramIntent)}><option value="auto">Auto</option><option value="sequence">Sequence</option><option value="flowchart">Flowchart</option></select></label>
      {!configured && <p className="ai-status ai-status-error">AI is not configured. <button onClick={onOpenAiSettings}>Open AI Settings</button></p>}
      {stream.status === "idle" && configured && <div className="about-dialog-actions"><button onClick={() => void service.run(config, format, intent, markdown)}>Generate</button><button onClick={() => void close()}>Close</button></div>}
      {stream.status === "running" && <><p className="ai-status ai-status-testing">Generating…</p><pre className="ai-result-preview">{stream.result}</pre><div className="about-dialog-actions"><button onClick={() => void service.cancel()}>Cancel</button><button onClick={() => void close()}>Close</button></div></>}
      {stream.status === "completed" && <><div className="plantuml-editor"><textarea aria-label="Generated diagram source" className="ai-result-preview" value={source} onChange={(e) => { setSource(e.target.value); setSvg(""); }} /><div className="plantuml-preview-pane">{validationError && <div role="alert" className="diagram-render-error">Diagram validation failed: {validationError}</div>}{svg && <div className="plantuml-preview" dangerouslySetInnerHTML={{ __html: sanitizeHtml(svg) }} />}</div></div><div className="about-dialog-actions"><button onClick={() => void validate()}>Validate Preview</button><button disabled={!svg} onClick={() => onConfirm({ format, intent, source }, svg)}>Save / Insert</button><button onClick={() => void service.run(config!, format, intent, markdown)}>Retry</button><button onClick={() => void close()}>Discard</button></div></>}
      {(stream.status === "error" || stream.status === "cancelled") && <><p className="ai-status ai-status-error">{stream.status === "cancelled" ? "Cancelled" : aiError}</p><div className="about-dialog-actions"><button disabled={!configured} onClick={() => void service.run(config!, format, intent, markdown)}>Retry</button><button onClick={() => void close()}>Close</button></div></>}
    </section>
  </div>;
}
