import { uiText } from "../lib/uiText";
import { Dialog } from "./Dialog";
import { AiErrorFeedback } from "./AiErrorFeedback";
import { useEffect, useRef, useState } from "react";
import type { AiConfig } from "../types";
import {
  isAiConfigured,
  type AiSelectionSnapshot,
  type AiTaskKind,
} from "../lib/aiSelection";
import { AiSelectionActionService } from "../lib/aiSelectionAction";
import { loadAiConfig } from "../lib/tauri";

interface Props {
  task: AiTaskKind;
  snapshot: AiSelectionSnapshot;
  onApply: (mode: "replace" | "insert", result: string, snapshot: AiSelectionSnapshot) => void;
  onOpenAiSettings: () => void;
  onClose: () => void;
  onRunningChange: (running: boolean) => void;
}

export function AiSelectionActionDialog({
  task,
  snapshot,
  onApply,
  onOpenAiSettings,
  onClose,
  onRunningChange,
}: Props) {
  const serviceRef = useRef<AiSelectionActionService | null>(null);
  if (!serviceRef.current) serviceRef.current = new AiSelectionActionService();
  const service = serviceRef.current;

  const [state, setState] = useState(service.getState());
  const [result, setResult] = useState(service.getResult());
  const [error, setError] = useState(service.getError());
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const unsubscribe = service.subscribe(() => {
      setState(service.getState());
      setResult(service.getResult());
      setError(service.getError());
      onRunningChange(service.isRunning());
    });
    onRunningChange(service.isRunning());
    return unsubscribe;
  }, [service, onRunningChange]);

  useEffect(() => {
    loadAiConfig()
      .then((loaded) => setConfig(loaded))
      .catch(() => setConfig(null));
  }, []);

  const close = async () => {
    if (service.isRunning()) {
      await service.cancel();
    }
    onClose();
  };

  const run = async () => {
    if (!config) return;
    if (!isAiConfigured(config)) return;
    await service.run(config, task, snapshot);
  };

  const handleApply = (mode: "replace" | "insert") => {
    if (!service.canApply()) return;
    onApply(mode, result, snapshot);
  };

  const discard = () => {
    service.discard();
    onClose();
  };

  const configured = config !== null && isAiConfigured(config);

  return (
    <Dialog className="about-dialog ai-result-dialog" onClose={() => void close()} title={<>AI {uiText(task)}</>} initialFocus={closeButtonRef}>
      {!configured && (
        <>
          <p className="ai-status ai-status-error">
            {uiText("AI is not configured. Open AI Settings to configure an OpenAI Compatible API.")}</p>
          <div className="about-dialog-actions">
            <button type="button" onClick={onOpenAiSettings}>{uiText("Open AI Settings")}</button>
            <button ref={closeButtonRef} type="button" onClick={() => void close()}>{uiText("Close")}</button>
          </div>
        </>
      )}
      {configured && state === "idle" && (
        <div className="about-dialog-actions">
          <button type="button" onClick={() => void run()}>{uiText("Generate")}</button>
          <button ref={closeButtonRef} type="button" onClick={() => void close()}>{uiText("Close")}</button>
        </div>
      )}
      {state === "running" && (
        <>
          <p className="ai-status ai-status-testing">
            <span className="ai-spinner" aria-hidden="true" />
            {uiText("Generating…")}</p>
          <pre className="ai-result-preview">{result}</pre>
          <div className="about-dialog-actions">
            <button type="button" onClick={() => void service.cancel()}>{uiText("Cancel")}</button>
            <button ref={closeButtonRef} type="button" onClick={() => void close()}>{uiText("Close")}</button>
          </div>
        </>
      )}
      {state === "completed" && (
        <>
          <div className="ai-result-labels">
            <span>{uiText("Result")}</span>
            <button type="button" onClick={() => setShowOriginal((v) => !v)}>
              {showOriginal ? uiText("Hide Original") : uiText("Show Original")}
            </button>
          </div>
          {showOriginal && <pre className="ai-result-original">{snapshot.text}</pre>}
          <pre className="ai-result-preview">{result}</pre>
          <div className="about-dialog-actions">
            <button type="button" onClick={() => handleApply("replace")}>{uiText("Replace Selection")}</button>
            <button type="button" onClick={() => handleApply("insert")}>{uiText("Insert Below")}</button>
            <button type="button" onClick={discard}>{uiText("Discard")}</button>
            <button ref={closeButtonRef} type="button" onClick={() => void close()}>{uiText("Close")}</button>
          </div>
        </>
      )}
      {state === "cancelled" && (
        <>
          <p className="ai-status ai-status-error">{uiText("Cancelled")}</p>
          <div className="about-dialog-actions">
            <button type="button" onClick={() => void run()}>{uiText("Retry")}</button>
            <button ref={closeButtonRef} type="button" onClick={() => void close()}>{uiText("Close")}</button>
          </div>
        </>
      )}
      {state === "error" && (
        <>
          {error && <AiErrorFeedback error={error} />}
          <div className="about-dialog-actions">
            <button type="button" onClick={() => void run()}>{uiText("Retry")}</button>
            <button ref={closeButtonRef} type="button" onClick={() => void close()}>{uiText("Close")}</button>
          </div>
        </>
      )}
    </Dialog>
  );
}
