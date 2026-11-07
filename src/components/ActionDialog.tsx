import { uiText } from "../lib/uiText";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Dialog } from "./Dialog";

export interface ActionRequest {
  title: string;
  message?: string;
  initialValue?: string;
  label?: string;
  confirmLabel?: string;
  suffix?: string;
  options?: Array<{ value: string; label: string }>;
  validate?: (value: string) => string | null;
}

function ActionDialog({ request, resolve }: { request: ActionRequest; resolve: (value: string | null) => void }) {
  const [value, setValue] = useState(request.initialValue ?? "");
  const error = request.validate?.(value);
  const confirm = () => { if (!error) resolve(value); };
  return <Dialog title={request.title} onClose={() => resolve(null)}>
    {request.message && <p>{request.message}</p>}
    {request.initialValue !== undefined && <form onSubmit={(event) => { event.preventDefault(); confirm(); }}>
      <label className="action-field">
        <span>{request.label ?? uiText("Name")}</span>
        {request.options
          ? <select value={value} onChange={(event) => setValue(event.target.value)}>
            {request.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          : <span className="action-input"><input value={value} onChange={(event) => setValue(event.target.value)} />{request.suffix}</span>}
      </label>
      {error && <p role="status">{error}</p>}
      <div className="about-dialog-actions">
        <button type="button" onClick={() => resolve(null)}>{uiText("Cancel")}</button>
        <button type="submit" disabled={Boolean(error)}>{request.confirmLabel ?? uiText("Continue")}</button>
      </div>
    </form>}
    {request.initialValue === undefined && <div className="about-dialog-actions">
      <button type="button" onClick={() => resolve(null)}>{uiText("Cancel")}</button>
      <button type="button" onClick={confirm}>{request.confirmLabel ?? uiText("Continue")}</button>
    </div>}
  </Dialog>;
}

export function useActionDialog(): { ask: (request: ActionRequest) => Promise<string | null>; dialog: ReactNode } {
  const [request, setRequest] = useState<ActionRequest | null>(null);
  const pending = useRef<((value: string | null) => void) | null>(null);
  const resolve = (value: string | null) => {
    pending.current?.(value);
    pending.current = null;
    setRequest(null);
  };
  useEffect(() => () => { pending.current?.(null); }, []);
  return {
    ask: (next) => {
      if (pending.current) return Promise.resolve(null);
      return new Promise((done) => {
        pending.current = done;
        setRequest(next);
      });
    },
    dialog: request ? <ActionDialog request={request} resolve={resolve} /> : null,
  };
}
