import { uiText } from "../lib/uiText";
import { Dialog } from "./Dialog";
import { AiErrorFeedback } from "./AiErrorFeedback";
import { readAiError } from "../lib/aiSelection";
import { useEffect, useRef, useState } from "react";
import type { AiConfig, AiError } from "../types";
import {
  listAiModels,
  loadAiConfig,
  saveAiConfig,
  testAiConnection,
} from "../lib/tauri";

interface Props {
  onClose: () => void;
}

const DEFAULT_CONFIG: AiConfig = {
  provider: "OpenAiCompatible",
  base_url: "http://localhost:11434/v1",
  api_key: null,
  model: "",
  temperature: 0.7,
  max_output_tokens: 4096,
  connect_timeout_seconds: 10,
  request_timeout_seconds: 300,
};

export function AiSettingsDialog({ onClose }: Props) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [config, setConfig] = useState<AiConfig>(DEFAULT_CONFIG);
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<AiError | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadAiConfig()
      .then((loaded) => setConfig(loaded))
      .catch(() => {
        // 未保存なら既定値のまま。
      });
  }, []);

  const update = (patch: Partial<AiConfig>) => {
    setConfig((prev) => ({ ...prev, ...patch }));
  };

  const handleSave = async () => {
    setBusy(true);
    try {
      await saveAiConfig(config);
      setStatus("saved");
    } catch (reason) {
      setStatus("error");
      setRequestError(readAiError(reason));
    } finally {
      setBusy(false);
    }
  };

  const handleRefreshModels = async () => {
    setBusy(true);
    try {
      const list = await listAiModels(config.base_url, config.api_key, config.connect_timeout_seconds);
      setModels(list);
      setStatus("models-loaded");
    } catch (reason) {
      setStatus("models-error");
      setRequestError(readAiError(reason));
    } finally {
      setBusy(false);
    }
  };

  const handleTestConnection = async () => {
    setBusy(true);
    setStatus("testing");
    try {
      await testAiConnection(config.base_url, config.api_key, config.model, config.connect_timeout_seconds);
      setStatus("connected");
    } catch (reason) {
      setStatus("connection-error");
      setRequestError(readAiError(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog onClose={onClose} title={uiText("AI Settings")} initialFocus={closeButtonRef}>
      <label>
        {uiText("Provider")}<select
          value={config.provider}
          onChange={(event) =>
            update({ provider: event.target.value as AiConfig["provider"] })
          }
        >
          <option value="OpenAiCompatible">{uiText("OpenAI Compatible")}</option>
        </select>
      </label>
      <label>
        {uiText("Base URL")}<input
          type="text"
          value={config.base_url}
          onChange={(event) => update({ base_url: event.target.value })}
        />
      </label>
      <label>
        {uiText("API Key")}<div className="ai-field-row">
          <input
            type={showKey ? "text" : "password"}
            value={config.api_key ?? ""}
            onChange={(event) => update({ api_key: event.target.value })}
          />
          <button type="button" onClick={() => setShowKey((v) => !v)}>
            {showKey ? uiText("Hide") : uiText("Show")}
          </button>
        </div>
      </label>
      <label>
        {uiText("Model")}<input
          type="text"
          list="ai-model-list"
          value={config.model}
          onChange={(event) => update({ model: event.target.value })}
        />
        <datalist id="ai-model-list">
          {models.map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>
      </label>
      <label>
        {uiText("Temperature")}<input
          type="number"
          step="0.1"
          value={config.temperature ?? ""}
          onChange={(event) =>
            update({ temperature: Number(event.target.value) })
          }
        />
      </label>
      <label>
        {uiText("Max Output Tokens")}<input
          type="number"
          value={config.max_output_tokens ?? ""}
          onChange={(event) =>
            update({ max_output_tokens: Number(event.target.value) })
          }
        />
      </label>
      <label>
        {uiText("Connection Timeout (seconds)")}<input
          type="number"
          min={1}
          max={3600}
          value={config.connect_timeout_seconds ?? ""}
          onChange={(event) =>
            update({ connect_timeout_seconds: event.target.value === "" ? null : Number(event.target.value) })
          }
        />
      </label>
      <label>
        {uiText("Request Timeout (seconds)")}<input
          type="number"
          min={1}
          max={3600}
          value={config.request_timeout_seconds ?? ""}
          onChange={(event) =>
            update({ request_timeout_seconds: Number(event.target.value) })
          }
        />
      </label>
      <div className="about-dialog-actions">
        <button type="button" onClick={handleRefreshModels} disabled={busy}>
          {uiText("Refresh Models")}</button>
        <button type="button" onClick={handleTestConnection} disabled={busy}>
          {uiText("Test Connection")}</button>
        <button type="button" onClick={handleSave} disabled={busy}>
          {uiText("Save")}</button>
        <button ref={closeButtonRef} type="button" onClick={onClose}>
          {uiText("Close")}</button>
      </div>
      {status === "saved" && <p>{uiText("Saved.")}</p>}
      {status === "error" && requestError &&
        <AiErrorFeedback heading={uiText("Failed to save.")} error={requestError} />}
      {status === "models-loaded" && <p>{uiText("Models loaded.")}</p>}
      {status === "models-error" && requestError &&
        <AiErrorFeedback className="ai-connection-error" heading={uiText("Failed to load models.")} error={requestError} />}
      {status === "testing" && (
        <p className="ai-status ai-status-testing">
          <span className="ai-spinner" aria-hidden="true" />
          {uiText("Connecting…")}</p>
      )}
      {status === "connected" && <p className="ai-status ai-status-ok">{uiText("Connection OK.")}</p>}
      {status === "connection-error" && requestError &&
        <AiErrorFeedback className="ai-connection-error" heading={uiText("Connection failed.")} error={requestError} />}
    </Dialog>
  );
}
