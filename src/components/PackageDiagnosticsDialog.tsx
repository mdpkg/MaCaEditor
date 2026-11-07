import { uiText } from "../lib/uiText";
import { ResultsPanel } from "./ResultsPanel";
import { useMemo, useState } from "react";
import type { PackageDiagnostic } from "../lib/packageDiagnostics";

interface Props {
  diagnostics: PackageDiagnostic[];
  onNavigate: (path: string, line?: number, offset?: number) => void;
  onClose: () => void;
}

export function PackageDiagnosticsDialog({ diagnostics, onNavigate, onClose }: Props) {
  const [severity, setSeverity] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const key = (item: PackageDiagnostic) => `${item.code}:${item.path}:${item.offset ?? item.line ?? 0}:${item.target ?? ""}`;
  const items = useMemo(() => diagnostics.filter((item) => severity === "all" || item.severity === severity)
    .sort((a, b) => Number(a.severity !== "error") - Number(b.severity !== "error")
      || a.path.localeCompare(b.path) || (a.line ?? 0) - (b.line ?? 0)), [diagnostics, severity]);
  const active = Math.max(0, items.findIndex((item) => key(item) === selected));
  const navigate = (index: number) => {
    const item = items[index];
    if (!item) return;
    setSelected(key(item)); onNavigate(item.path, item.line, item.offset);
  };
  const errors = diagnostics.filter((item) => item.severity === "error").length;
  const warnings = diagnostics.length - errors;
  return (
    <ResultsPanel className="package-diagnostics-dialog" onClose={onClose} title={uiText("Package diagnostics")}>
      <label>重大度<select aria-label="診断の重大度" value={severity} onChange={(event) => { setSeverity(event.target.value); setSelected(null); }}>
        <option value="all">すべて</option><option value="error">エラー</option><option value="warning">警告</option>
      </select></label>
      <div className="results-navigation">
        <button disabled={!items.length} onClick={() => navigate((active - 1 + items.length) % items.length)}>前の問題</button>
        <button disabled={!items.length} onClick={() => navigate((active + 1) % items.length)}>次の問題</button>
        <button onClick={onClose}>{uiText("Close")}</button>
      </div>
      {diagnostics.length === 0 ? <p>{uiText("No issues found.")}</p> : (
        <>
          <p role="status">エラー {errors} 件、警告 {warnings} 件（表示 {items.length} 件）</p>
          {items.length === 0 && <p>この重大度の問題はありません。</p>}
          <ul className="package-diagnostics-list">
            {items.map((item, index) => (
              <li key={`${item.code}-${item.path}-${item.offset ?? index}`} data-severity={item.severity}>
                <button type="button" aria-current={index === active ? "true" : undefined} onClick={() => navigate(index)}>
                  <span>{item.severity === "error" ? uiText("Error") : uiText("Warning")}: {item.message}</span>
                  <small>{item.path}{item.line ? `:${item.line}` : ""}</small>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </ResultsPanel>
  );
}
