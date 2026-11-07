import { uiText } from "../lib/uiText";
import { useId, useState } from "react";

export function ErrorDetails({ detail, inline = false }: { detail: string; inline?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const detailId = useId();
  if (inline) {
    return (
      <span className="error-details">
        <button type="button" aria-expanded={expanded} aria-controls={detailId}
          onClick={() => setExpanded((current) => !current)}>{uiText("Details")}</button>
        <span className="error-detail" id={detailId} hidden={!expanded}>{detail}</span>
      </span>
    );
  }
  return (
    <details className="error-details">
      <summary>{uiText("Details")}</summary>
      <div className="error-detail">{detail}</div>
    </details>
  );
}
