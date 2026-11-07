import { uiText } from "../lib/uiText";
import { ErrorDetails } from "./ErrorDetails";

export function DiagramRenderError({
  detail, summary = uiText("Diagram rendering failed."), inline = false,
}: { detail: string; summary?: string; inline?: boolean }) {
  const Container = inline ? "span" : "div";
  return (
    <Container className="diagram-render-error">
      <Container role="alert">{summary}</Container>
      <ErrorDetails detail={detail} inline={inline} />
    </Container>
  );
}
