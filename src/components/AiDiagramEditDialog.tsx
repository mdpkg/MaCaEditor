import { uiText } from "../lib/uiText";
import { Dialog } from "./Dialog";
import { DiagramRenderError } from "./DiagramRenderError";
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

  return <Dialog className="about-dialog ai-result-dialog ai-diagram-dialog ai-diagram-edit-dialog" onClose={() => void close()} title={<>{uiText("AI Generate")}{format === "plantuml" ? "PlantUML" : "Mermaid"}</>}>
    <label className="ai-diagram-edit-instruction">{uiText("Diagram description")}<textarea aria-label={uiText("Diagram generation description")} value={instruction} disabled={stream.status === "running"} onChange={(e) => setInstruction(e.target.value)} /></label>
    {!configured && <p className="ai-status ai-status-error">{uiText("AI is not configured.")}<button onClick={onOpenAiSettings}>{uiText("Open AI Settings")}</button></p>}
    {(stream.status === "idle" || stream.status === "error" || stream.status === "cancelled") && <><div className="about-dialog-actions"><button disabled={!configured || !instruction.trim()} onClick={() => void run()}>{stream.status === "idle" ? uiText("Generate Diagram") : uiText("Retry")}</button><button onClick={() => void close()}>{uiText("Cancel")}</button></div>{stream.status === "error" && <p className="ai-status ai-status-error">{error}</p>}{stream.status === "cancelled" && <p className="ai-status ai-status-error">{uiText("Cancelled")}</p>}</>}
    {stream.status === "running" && <><p className="ai-status ai-status-testing">{uiText("Generating…")}</p><pre className="ai-result-preview">{stream.result}</pre><div className="about-dialog-actions"><button onClick={() => void service.cancel()}>{uiText("Cancel request")}</button><button onClick={() => void close()}>{uiText("Close")}</button></div></>}
    {stream.status === "completed" && <><button type="button" onClick={() => setShowOriginal((value) => !value)}>{showOriginal ? uiText("Hide Original") : uiText("Show Original")}</button>{showOriginal && <pre aria-label={uiText("Original diagram source")} className="ai-result-original">{snapshot.source}</pre>}<pre aria-label={uiText("Updated diagram source")} className="ai-result-preview">{stream.result}</pre>{validating && <p>{uiText("Validating…")}</p>}{validationError && <DiagramRenderError summary={uiText("Diagram validation failed:")} detail={validationError} />}{svg && <div className="plantuml-preview" dangerouslySetInnerHTML={{ __html: sanitizeHtml(svg) }} />}<div className="about-dialog-actions"><button disabled={!svg || validating} onClick={() => onApply(stream.result, snapshot)}>{uiText("Apply")}</button><button onClick={() => void run()}>{uiText("Retry")}</button><button onClick={() => void close()}>{uiText("Discard")}</button></div></>}
  </Dialog>;
}
