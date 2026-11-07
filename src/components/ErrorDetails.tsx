import { uiText } from "../lib/uiText";

export function ErrorDetails({ detail }: { detail: string }) {
  return (
    <details className="error-details">
      <summary>{uiText("Details")}</summary>
      <div className="error-detail">{detail}</div>
    </details>
  );
}
