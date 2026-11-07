import type { AiError } from "../types";
import { aiErrorMessage } from "../lib/aiSelection";
import { ErrorDetails } from "./ErrorDetails";

export function AiErrorFeedback({
  error, heading, className,
}: { error: AiError; heading?: string; className?: string }) {
  const summary = heading && error.kind === "Unknown"
    ? heading
    : (heading ?? "") + aiErrorMessage(error.kind);
  return (
    <div className={className}>
      <div className="ai-status-error" role="alert">{summary}</div>
      {"message" in error && error.message && <ErrorDetails detail={error.message} />}
    </div>
  );
}
