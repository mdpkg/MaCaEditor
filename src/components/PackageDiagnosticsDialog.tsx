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
    <div className="about-dialog-backdrop" onPointerDown={onClose}>
      <section className="about-dialog package-diagnostics-dialog" role="dialog" aria-modal="true"
        aria-label="Package diagnostics" onPointerDown={(event) => event.stopPropagation()}>
        <h2>Package diagnostics</h2>
        {diagnostics.length === 0 ? <p>No issues found.</p> : (
          <>
            <p>{errors} {errors === 1 ? "error" : "errors"}, {warnings} {warnings === 1 ? "warning" : "warnings"}</p>
            <ul className="package-diagnostics-list">
              {diagnostics.map((item, index) => (
                <li key={`${item.code}-${item.path}-${item.offset ?? index}`} data-severity={item.severity}>
                  <button type="button" onClick={() => onNavigate(item.path, item.line)}>
                    <span>{item.severity === "error" ? "Error" : "Warning"}: {item.message}</span>
                    <small>{item.path}{item.line ? `:${item.line}` : ""}</small>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="about-dialog-actions"><button type="button" onClick={onClose}>Close</button></div>
      </section>
    </div>
  );
}
