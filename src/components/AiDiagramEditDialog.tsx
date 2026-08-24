import { useEffect, useRef, useState } from "react";
import type { AiConfig } from "../types";
import { type DiagramFormat } from "../lib/aiDiagram";
import { AiDiagramEditService } from "../lib/aiDiagramEdit";
import { aiErrorMessage, isAiConfigured, type AiErrorKind } from "../lib/aiSelection";
import { loadAiConfig } from "../lib/tauri";
import { sanitizeHtml } from "../lib/sanitize";
import { validateDiagramSource } from "../lib/aiDiagramValidation";

interface Props {
  format: DiagramFormat; path: string; currentSource: string;
  onApply: (source: string, snapshot: { path: string; source: string }) => void;
  onClose: () => void; onOpenAiSettings: () => void;
}

export function AiDiagramEditDialog({ format, path, currentSource, onApply, onClose, onOpenAiSettings }: Props) {
  const serviceRef = useRef(new AiDiagramEditService());
  const service = serviceRef.current;
  const [stream, setStream] = useState(service.getState());
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [instruction, setInstruction] = useState("");
  const [snapshot, setSnapshot] = useState({ path, source: currentSource });
  const [svg, setSvg] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);

  useEffect(() => service.subscribe(() => setStream(service.getState())), [service]);
  useEffect(() => { void loadAiConfig().then(setConfig).catch(() => setConfig(null)); }, []);
  useEffect(() => () => { void service.cancel(); }, [service]);
  useEffect(() => {
    if (stream.status !== "completed") return;
    setSvg(""); setValidationError(null); setValidating(true);
    void validateDiagramSource(format, stream.result).then(setSvg).catch((reason) => setValidationError(String(reason))).finally(() => setValidating(false));
  }, [stream.status, stream.result, format]);

  const run = async () => {
    if (!config || !isAiConfigured(config) || !instruction.trim()) return;
    const nextSnapshot = { path, source: currentSource };
    setSnapshot(nextSnapshot); setSvg(""); setValidationError(null);
    await service.run(config, format, nextSnapshot.source, instruction);
  };
  const close = async () => { await service.cancel(); onClose(); };
  const configured = config !== null && isAiConfigured(config);
  const error = stream.errorKind ? aiErrorMessage(stream.errorKind as AiErrorKind) : null;

  return <div className="about-dialog-backdrop" onPointerDown={() => void close()}>
    <section className="about-dialog ai-result-dialog ai-diagram-dialog ai-diagram-edit-dialog" role="dialog" aria-modal="true" aria-label="AI Edit Diagram" onPointerDown={(e) => e.stopPropagation()}>
      <h2>AI Edit {format === "plantuml" ? "PlantUML" : "Mermaid"}</h2>
      <label className="ai-diagram-edit-instruction">Instruction<textarea aria-label="Diagram edit instruction" value={instruction} disabled={stream.status === "running"} onChange={(e) => setInstruction(e.target.value)} /></label>
      {!configured && <p className="ai-status ai-status-error">AI is not configured. <button onClick={onOpenAiSettings}>Open AI Settings</button></p>}
      {(stream.status === "idle" || stream.status === "error" || stream.status === "cancelled") && <><div className="about-dialog-actions"><button disabled={!configured || !instruction.trim()} onClick={() => void run()}>{stream.status === "idle" ? "Generate Changes" : "Retry"}</button><button onClick={() => void close()}>Cancel</button></div>{stream.status === "error" && <p className="ai-status ai-status-error">{error}</p>}{stream.status === "cancelled" && <p className="ai-status ai-status-error">Cancelled</p>}</>}
      {stream.status === "running" && <><p className="ai-status ai-status-testing">Generating…</p><pre className="ai-result-preview">{stream.result}</pre><div className="about-dialog-actions"><button onClick={() => void service.cancel()}>Cancel request</button><button onClick={() => void close()}>Close</button></div></>}
      {stream.status === "completed" && <><button type="button" onClick={() => setShowOriginal((value) => !value)}>{showOriginal ? "Hide Original" : "Show Original"}</button>{showOriginal && <pre aria-label="Original diagram source" className="ai-result-original">{snapshot.source}</pre>}<pre aria-label="Updated diagram source" className="ai-result-preview">{stream.result}</pre>{validating && <p>Validating…</p>}{validationError && <div role="alert" className="diagram-render-error">Diagram validation failed: {validationError}</div>}{svg && <div className="plantuml-preview" dangerouslySetInnerHTML={{ __html: sanitizeHtml(svg) }} />}<div className="about-dialog-actions"><button disabled={!svg || validating} onClick={() => onApply(stream.result, snapshot)}>Apply</button><button onClick={() => void run()}>Retry</button><button onClick={() => void close()}>Discard</button></div></>}
    </section>
  </div>;
}
