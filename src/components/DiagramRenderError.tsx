import { uiText } from "../lib/uiText";

export function DiagramRenderError({ detail }: { detail: string }) {
  return (
    <div className="diagram-render-error">
      <div role="alert">{uiText("Diagram rendering failed.")}</div>
      <details>
        <summary>{uiText("Details")}</summary>
        {detail}
      </details>
    </div>
  );
}
