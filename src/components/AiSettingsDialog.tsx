import { useEffect, useRef, useState } from "react";
import type { AiConfig } from "../types";
import { loadAiConfig, saveAiConfig } from "../lib/tauri";

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
};

export function AiSettingsDialog({ onClose }: Props) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [config, setConfig] = useState<AiConfig>(DEFAULT_CONFIG);
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

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
    try {
      await saveAiConfig(config);
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  };

  return (
    <div className="about-dialog-backdrop" onPointerDown={onClose}>
      <section
        className="about-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="AI Settings"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <h2>AI Settings</h2>
        <label>
          Provider
          <select
            value={config.provider}
            onChange={(event) =>
              update({ provider: event.target.value as AiConfig["provider"] })
            }
          >
            <option value="OpenAiCompatible">OpenAI Compatible</option>
          </select>
        </label>
        <label>
          Base URL
          <input
            type="text"
            value={config.base_url}
            onChange={(event) => update({ base_url: event.target.value })}
          />
        </label>
        <label>
          API Key
          <input
            type={showKey ? "text" : "password"}
            value={config.api_key ?? ""}
            onChange={(event) => update({ api_key: event.target.value })}
          />
          <button type="button" onClick={() => setShowKey((v) => !v)}>
            {showKey ? "Hide" : "Show"}
          </button>
        </label>
        <label>
          Model
          <input
            type="text"
            value={config.model}
            onChange={(event) => update({ model: event.target.value })}
          />
        </label>
        <label>
          Temperature
          <input
            type="number"
            step="0.1"
            value={config.temperature ?? ""}
            onChange={(event) =>
              update({ temperature: Number(event.target.value) })
            }
          />
        </label>
        <label>
          Max Output Tokens
          <input
            type="number"
            value={config.max_output_tokens ?? ""}
            onChange={(event) =>
              update({ max_output_tokens: Number(event.target.value) })
            }
          />
        </label>
        <div className="about-dialog-actions">
          <button type="button" onClick={handleSave}>
            Save
          </button>
          <button ref={closeButtonRef} type="button" onClick={onClose}>
            Close
          </button>
        </div>
        {status === "saved" && <p>Saved.</p>}
        {status === "error" && <p>Failed to save.</p>}
      </section>
    </div>
  );
}
