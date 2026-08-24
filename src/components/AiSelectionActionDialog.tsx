import { useEffect, useRef, useState } from "react";
import type { AiConfig, AiStreamEvent } from "../types";
import {
  aiErrorMessage,
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
}

export function AiSelectionActionDialog({
  task,
  snapshot,
  onApply,
  onOpenAiSettings,
  onClose,
}: Props) {
  const serviceRef = useRef<AiSelectionActionService | null>(null);
  if (!serviceRef.current) serviceRef.current = new AiSelectionActionService();
  const service = serviceRef.current;

  const [state, setState] = useState(service.getState());
  const [result, setResult] = useState(service.getResult());
  const [errorKind, setErrorKind] = useState(service.getErrorKind());
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        void close();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  useEffect(() => {
    const unsubscribe = service.subscribe(() => {
      setState(service.getState());
      setResult(service.getResult());
      setErrorKind(service.getErrorKind());
    });
    return unsubscribe;
  }, [service]);

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
    <div className="about-dialog-backdrop" onPointerDown={() => void close()}>
      <section
        className="about-dialog ai-result-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`AI ${task}`}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <h2>AI {task}</h2>
        {!configured && (
          <>
            <p className="ai-status ai-status-error">
              AI is not configured. Open AI Settings to configure an OpenAI Compatible API.
            </p>
            <div className="about-dialog-actions">
              <button type="button" onClick={onOpenAiSettings}>Open AI Settings</button>
              <button ref={closeButtonRef} type="button" onClick={() => void close()}>Close</button>
            </div>
          </>
        )}
        {configured && state === "idle" && (
          <div className="about-dialog-actions">
            <button type="button" onClick={() => void run()}>Generate</button>
            <button ref={closeButtonRef} type="button" onClick={() => void close()}>Close</button>
          </div>
        )}
        {state === "running" && (
          <>
            <p className="ai-status ai-status-testing">
              <span className="ai-spinner" aria-hidden="true" />
              Generating…
            </p>
            <pre className="ai-result-preview">{result}</pre>
            <div className="about-dialog-actions">
              <button type="button" onClick={() => void service.cancel()}>Cancel</button>
              <button ref={closeButtonRef} type="button" onClick={() => void close()}>Close</button>
            </div>
          </>
        )}
        {state === "completed" && (
          <>
            <div className="ai-result-labels">
              <span>Result</span>
              <button type="button" onClick={() => setShowOriginal((v) => !v)}>
                {showOriginal ? "Hide Original" : "Show Original"}
              </button>
            </div>
            {showOriginal && <pre className="ai-result-original">{snapshot.text}</pre>}
            <pre className="ai-result-preview">{result}</pre>
            <div className="about-dialog-actions">
              <button type="button" onClick={() => handleApply("replace")}>Replace Selection</button>
              <button type="button" onClick={() => handleApply("insert")}>Insert Below</button>
              <button type="button" onClick={discard}>Discard</button>
              <button ref={closeButtonRef} type="button" onClick={() => void close()}>Close</button>
            </div>
          </>
        )}
        {state === "cancelled" && (
          <>
            <p className="ai-status ai-status-error">Cancelled</p>
            <div className="about-dialog-actions">
              <button type="button" onClick={() => void run()}>Retry</button>
              <button ref={closeButtonRef} type="button" onClick={() => void close()}>Close</button>
            </div>
          </>
        )}
        {state === "error" && (
          <>
            <p className="ai-status ai-status-error">
              {errorKind ? aiErrorMessage(errorKind) : "An error occurred."}
            </p>
            <div className="about-dialog-actions">
              <button type="button" onClick={() => void run()}>Retry</button>
              <button ref={closeButtonRef} type="button" onClick={() => void close()}>Close</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
