import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AiChatMessage } from "../lib/aiChat";
import { resolvePreviewLink } from "../lib/previewUrl";
import { uiText } from "../lib/uiText";

/** Stable message objects avoid reparsing completed history on every delta. */
export const AiChatMessageView = memo(function AiChatMessageView({ message, starting }: { message: AiChatMessage; starting: boolean }) {
  return <article className={`ai-chat-message ai-chat-${message.role}`}>
    <b>{message.role === "user" ? uiText("You") : "AI"}</b>
    {message.role === "user" ? <p>{message.content}</p> : <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
      img: ({ alt }) => <span>［画像は自動取得しません{alt ? `：${alt}` : ""}］</span>,
      a: ({ href = "", children }) => {
        const destination = resolvePreviewLink("", href);
        return destination.path === null && /^(https?:\/\/|mailto:)/i.test(destination.href)
          ? <a href={destination.href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>;
      },
    }}>{message.content}</ReactMarkdown>}
    {message.status === "complete" && !message.content.trim() && <p role="status">{uiText("AI returned no text.")}</p>}
    {message.status === "streaming" && <small>{starting ? "接続中…" : uiText("Generating…")}</small>}
    {message.status === "cancelled" && <small>{uiText("Cancelled")}</small>}
  </article>;
});
