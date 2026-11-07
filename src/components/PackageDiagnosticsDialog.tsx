import { uiText } from "../lib/uiText";
import { Dialog } from "./Dialog";
import type { PackageDiagnostic } from "../lib/packageDiagnostics";

interface Props {
  diagnostics: PackageDiagnostic[];
  onNavigate: (path: string, line?: number) => void;
  onClose: () => void;
}

export function PackageDiagnosticsDialog({ diagnostics, onNavigate, onClose }: Props) {
  const errors = diagnostics.filter((item) => item.severity === "error").length;
  const warnings = diagnostics.length - errors;
  return (
    <Dialog className="about-dialog package-diagnostics-dialog" onClose={onClose} title={uiText("Package diagnostics")}>
      {diagnostics.length === 0 ? <p>{uiText("No issues found.")}</p> : (
        <>
          <p>エラー {errors} 件、警告 {warnings} 件</p>
          <ul className="package-diagnostics-list">
            {diagnostics.map((item, index) => (
              <li key={`${item.code}-${item.path}-${item.offset ?? index}`} data-severity={item.severity}>
                <button type="button" onClick={() => onNavigate(item.path, item.line)}>
                  <span>{item.severity === "error" ? uiText("Error") : uiText("Warning")}: {item.message}</span>
                  <small>{item.path}{item.line ? `:${item.line}` : ""}</small>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="about-dialog-actions"><button type="button" onClick={onClose}>{uiText("Close")}</button></div>
    </Dialog>
  );
}
