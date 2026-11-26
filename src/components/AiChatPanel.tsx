import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { uiText } from "../lib/uiText";
import { AiErrorFeedback } from "./AiErrorFeedback";
import { ErrorDetails } from "./ErrorDetails";
import { shouldSendChatKey } from "../lib/aiChat";
import { CHAT_LIMITS } from "../lib/aiChatSessions";
import { ChatSessionsController } from "../lib/chatSessionsController";
import { isChatTransportBusy, subscribeChatTransport } from "../lib/chatTransport";

type Props = { controller: ChatSessionsController; onClose: () => void; onOpenAiSettings: () => void };
export function AiChatPanel({ controller, onClose, onOpenAiSettings }: Props) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const busy = useSyncExternalStore(subscribeChatTransport, isChatTransportBusy);
  const session = state.sessions.find((item) => item.id === state.selectedSessionId);
  const [composing, setComposing] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const configured = !!state.connection && !state.connectionError;
  const running = session?.phase === "starting" || session?.phase === "running";
  useLayoutEffect(() => {
    if (listRef.current && session) listRef.current.scrollTop = session.scrollTop;
  }, [session?.id]);
  useEffect(() => {
    if (listRef.current && session?.follow) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [session?.chat.messages]);
  useEffect(() => { inputRef.current?.focus(); }, [controller]);
  const close = () => {
    // Phase 2 changes panel close to a visibility-only operation.
    for (const item of state.sessions) if (item.owner) controller.stop(item.id);
    onClose();
  };
  return <aside className="ai-chat-panel" aria-label={uiText("AI Chat")}>
    <header><strong>{uiText("AI Chat")}</strong><div>
      <button disabled={!session} onClick={() => session && controller.clear(session.id)}>{uiText("Clear")}</button>
      <button aria-label={uiText("Close AI Chat")} onClick={close}>×</button>
    </div></header>
    {state.connection && <div className="ai-chat-document">接続先：{state.connection.endpoint} ／ モデル：{state.connection.model}</div>}
    {session && <div className="ai-chat-document" title={session.path}>{session.path} — このMarkdown全体（送信時点）</div>}
    {session?.pendingConnectionConfirmation && <div className="ai-chat-error" role="status">
      接続先が変更されました。この会話の履歴と対象Markdownを表示中の接続先へ送信します。
      <button onClick={() => state.connection && controller.confirm(session!.id, state.connection.revision)}>この会話の送信先を確認</button>
    </div>}
    {state.notice && <div className="ai-chat-error" role="status">{state.notice}</div>}
    <div className="ai-chat-messages" ref={listRef} onScroll={() => {
      const list = listRef.current;
      if (list && session) controller.scroll(session.id, list.scrollTop, list.scrollHeight - list.scrollTop - list.clientHeight < 80);
    }}>
      {!session && <p className="ai-chat-empty">会話がありません。</p>}
      {session?.chat.messages.length === 0 && <p className="ai-chat-empty">{uiText("Ask about the current Markdown document.")}</p>}
      {session?.chat.messages.map((message) => <article key={message.id} className={`ai-chat-message ai-chat-${message.role}`}>
        <b>{message.role === "user" ? uiText("You") : "AI"}</b>
        {message.role === "user" ? <p>{message.content}</p> : <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>}
        {message.status === "complete" && !message.content.trim() && <p role="status">{uiText("AI returned no text.")}</p>}
        {message.status === "streaming" && <small>{session.phase === "starting" ? "接続中…" : uiText("Generating…")}</small>}
        {message.status === "cancelled" && <small>{uiText("Cancelled")}</small>}
      </article>)}
      {session?.chat.error && <div className="ai-chat-error"><AiErrorFeedback error={session.chat.error} />
        <p>文脈が長すぎる場合は、新しい会話や会話の消去をご利用ください。</p>
        <button disabled={busy || session.pendingConnectionConfirmation} onClick={() => void controller.send(session.id, session.lastQuestion)}>{uiText("Retry")}</button>
      </div>}
    </div>
    {!configured && <div className="ai-chat-error">
      {state.connectionError === undefined ? uiText("AI is not configured.") : <>
        <div role="alert">{uiText("AI settings could not be loaded.")}</div><ErrorDetails detail={state.connectionError} />
      </>}
      <button onClick={onOpenAiSettings}>{uiText("AI Settings")}</button>
    </div>}
    {session && <footer>
      <textarea ref={inputRef} aria-label={uiText("AI Chat message")} value={session.draft} maxLength={CHAT_LIMITS.draftBytes}
        disabled={!configured || running} onChange={(event) => controller.draft(session.id, event.target.value)}
        onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}
        onKeyDown={(event) => { if (shouldSendChatKey(event.key, event.shiftKey, composing || event.nativeEvent.isComposing)) {
          event.preventDefault(); void controller.send(session.id);
        } }} />
      {running ? <button onClick={() => controller.stop(session.id)}>{uiText("Cancel")}</button>
        : <button disabled={!configured || busy || session.pendingConnectionConfirmation || !session.available || !session.draft.trim()}
          onClick={() => void controller.send(session.id)}>{session.phase === "cancelling" ? "停止処理中…" : uiText("Send")}</button>}
    </footer>}
  </aside>;
}
