import { uiText } from "../lib/uiText";
import { ErrorDetails } from "./ErrorDetails";

export function DiagramRenderError({ detail, summary = uiText("Diagram rendering failed.") }: { detail: string; summary?: string }) {
  return (
    <div className="diagram-render-error">
      <div role="alert">{summary}</div>
      <ErrorDetails detail={detail} />
    </div>
  );
}
