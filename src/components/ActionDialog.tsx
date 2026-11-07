import { uiText } from "../lib/uiText";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Dialog } from "./Dialog";
import { buildFileTree, type TreeNode } from "../lib/fileTree";

export interface ActionRequest {
  title: string;
  message?: string;
  initialValue?: string;
  label?: string;
  confirmLabel?: string;
  suffix?: string;
  folderPaths?: string[];
  validate?: (value: string) => string | null;
}

function FolderPicker({ paths, label, value, onChange, selected }: {
  paths: string[];
  label: string;
  value: string;
  onChange: (path: string) => void;
  selected: RefObject<HTMLInputElement>;
}) {
  const radio = (path: string, name: string) => (
    <label className="destination-choice" title={path || name}>
      <input ref={value === path ? selected : undefined} type="radio" name="destination" value={path} aria-label={path || name}
        checked={value === path} tabIndex={value === path ? 0 : -1} onChange={() => onChange(path)} />
      {name}
    </label>
  );
  const branches = (nodes: TreeNode[]): ReactNode => nodes.length > 0 && (
    <ul>{nodes.map((node) => (
      <li key={node.path}>{radio(node.path, node.name)}{branches(node.children)}</li>
    ))}</ul>
  );
  return (
    <fieldset className="destination-picker">
      <legend>{label}</legend>
      <div className="destination-tree">
        {radio("", uiText("Package root"))}
        {branches(buildFileTree([], paths.filter(Boolean)))}
      </div>
    </fieldset>
  );
}

function ActionDialog({ request, resolve }: { request: ActionRequest; resolve: (value: string | null) => void }) {
  const [value, setValue] = useState(request.initialValue ?? "");
  const folderFocus = useRef<HTMLInputElement>(null);
  const error = request.validate?.(value);
  const confirm = () => { if (!error) resolve(value); };
  return <Dialog title={request.title} onClose={() => resolve(null)} initialFocus={request.folderPaths ? folderFocus : undefined}>
    {request.message && <p>{request.message}</p>}
    {request.initialValue !== undefined && <form onSubmit={(event) => { event.preventDefault(); confirm(); }}>
      {request.folderPaths
        ? <FolderPicker paths={request.folderPaths} label={request.label ?? uiText("Destination folder")}
          value={value} onChange={setValue} selected={folderFocus} />
        : <label className="action-field">
          <span>{request.label ?? uiText("Name")}</span>
          <span className="action-input"><input value={value} onChange={(event) => setValue(event.target.value)} />{request.suffix}</span>
        </label>}
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
