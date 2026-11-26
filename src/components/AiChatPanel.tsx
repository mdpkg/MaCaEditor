import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { uiText } from "../lib/uiText";
import { AiErrorFeedback } from "./AiErrorFeedback";
import { ErrorDetails } from "./ErrorDetails";
import { AiChatTabs, chatPanelId, chatTabId } from "./AiChatTabs";
import type { ActionRequest } from "./ActionDialog";
import { shouldSendChatKey } from "../lib/aiChat";
import { CHAT_LIMITS } from "../lib/aiChatSessions";
import { ChatSessionsController } from "../lib/chatSessionsController";
import { chatRequestOwner, isChatTransportBusy, subscribeChatTransport } from "../lib/chatTransport";

type Props = { controller: ChatSessionsController; markdownPath?: string; onClose: () => void; onOpenAiSettings: () => void;
  onConfirm?: (request: ActionRequest) => Promise<boolean>; focusInputRequest?: number };
export function AiChatPanel({ controller, markdownPath, onClose, onOpenAiSettings, onConfirm, focusInputRequest = 0 }: Props) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const busy = useSyncExternalStore(subscribeChatTransport, isChatTransportBusy);
  const session = state.sessions.find((item) => item.id === state.selectedSessionId);
  const generating = state.sessions.find((item) => item.id === chatRequestOwner()?.sessionId);
  const [composing, setComposing] = useState(false);
  const [tabFocus, setTabFocus] = useState(0), [inputFocus, setInputFocus] = useState(0);
  const listRef = useRef<HTMLDivElement>(null), inputRef = useRef<HTMLTextAreaElement>(null);
  const currentController = useRef(controller); currentController.current = controller;
  const confirming = useRef(false);
  const configured = !!state.connection && !state.connectionError;
  const running = session?.phase === "starting" || session?.phase === "running";
  useLayoutEffect(() => {
    if (listRef.current && session) listRef.current.scrollTop = session.scrollTop;
  }, [session?.id]);
  useEffect(() => { setComposing(false); }, [session?.id]);
  useEffect(() => {
    if (listRef.current && session?.follow) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [session?.chat.messages]);
  useLayoutEffect(() => {
    if (!document.querySelector('[role="dialog"][aria-modal="true"]')) inputRef.current?.focus();
  }, [controller, inputFocus, focusInputRequest]);
  const mutate = async (id: string, operation: "delete" | "clear") => {
    if (confirming.current) return;
    const owner = controller, before = owner.getSnapshot(), target = before.sessions.find((item) => item.id === id);
    if (!target) return;
    const hasContent = target.chat.messages.length > 0 || target.draft.length > 0;
    confirming.current = true;
    try {
      if (hasContent && !await onConfirm?.({ title: `${target.title}を${operation === "delete" ? "削除" : "消去"}しますか？`,
        message: `${target.path} のこの会話の履歴と下書きが失われます。`, confirmLabel: operation === "delete" ? "削除" : "消去" })) return;
      const current = owner.getSnapshot();
      if (currentController.current !== owner || current.selectedSessionId !== before.selectedSessionId || !current.sessions.some((item) => item.id === id)) return;
      if (operation === "delete") { owner.delete(id); setTabFocus((value) => value + 1); }
      else owner.clear(id);
    } finally { confirming.current = false; }
  };
  return <aside className="ai-chat-panel" aria-label={uiText("AI Chat")} onKeyDown={(event) => {
    if (event.key === "Escape" && !event.defaultPrevented && !composing && !event.nativeEvent.isComposing &&
        !document.querySelector('[role="dialog"][aria-modal="true"]')) { event.preventDefault(); event.stopPropagation(); onClose(); }
  }}>
    <header><strong>{uiText("AI Chat")}</strong><div>
      <button aria-label="この会話を消去" disabled={!session || (!session.chat.messages.length && !session.draft.length)}
        onClick={() => session && void mutate(session.id, "clear")}>{uiText("Clear")}</button>
      <button aria-label={uiText("Close AI Chat")} onClick={onClose}>×</button>
    </div></header>
    <AiChatTabs sessions={state.sessions} selectedId={state.selectedSessionId} canAdd={!!markdownPath} focusRequest={tabFocus}
      onSelect={(id) => controller.select(id)} onDelete={(id) => void mutate(id, "delete")}
      onAdd={() => { if (markdownPath && controller.add(markdownPath)) setInputFocus((value) => value + 1); }} />
    {busy && <div className="ai-chat-request-status" role="status">
      {generating ? `${generating.title}：${generating.phase === "cancelling" ? "停止処理中" : generating.phase === "starting" ? "接続中" : "生成中"}` : "前の会話の停止処理中…"}
      {generating && generating.id !== session?.id && <button onClick={() => { controller.select(generating.id); setTabFocus((value) => value + 1); }}>生成中の会話へ移動</button>}
    </div>}
    {state.connection && <div className="ai-chat-document">接続先：{state.connection.endpoint} ／ モデル：{state.connection.model}</div>}
    {state.notice && <div className="ai-chat-error" role="status">{state.notice}</div>}
    {state.sessions.filter((item) => item.id !== session?.id).map((item) => <section key={item.id} hidden role="tabpanel" id={chatPanelId(item.id)} aria-labelledby={chatTabId(item.id)} />)}
    {session ? <section key={session.id} role="tabpanel" id={chatPanelId(session.id)} aria-labelledby={chatTabId(session.id)} className="ai-chat-content">
      <div className="ai-chat-document" title={session.path}>{session.path} — このMarkdown全体（送信時点）</div>
      {!session.available && <p className="ai-chat-error" role="status">対象が削除された、または移動先を追跡できないため、この会話は読み取り専用です。</p>}
      {session.pendingConnectionConfirmation && <div className="ai-chat-error" role="status">
        接続先が変更されました。この会話の履歴と対象Markdownを表示中の接続先へ送信します。
        <button onClick={() => state.connection && controller.confirm(session.id, state.connection.revision)}>この会話の送信先を確認</button>
      </div>}
      <div className="ai-chat-messages" ref={listRef} onScroll={() => {
        const list = listRef.current;
        if (list) controller.scroll(session.id, list.scrollTop, list.scrollHeight - list.scrollTop - list.clientHeight < 80);
      }}>
        {session.chat.messages.length === 0 && <p className="ai-chat-empty">{uiText("Ask about the current Markdown document.")}</p>}
        {session.chat.messages.map((message) => <article key={message.id} className={`ai-chat-message ai-chat-${message.role}`}>
          <b>{message.role === "user" ? uiText("You") : "AI"}</b>
          {message.role === "user" ? <p>{message.content}</p> : <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>}
          {message.status === "complete" && !message.content.trim() && <p role="status">{uiText("AI returned no text.")}</p>}
          {message.status === "streaming" && <small>{session.phase === "starting" ? "接続中…" : uiText("Generating…")}</small>}
          {message.status === "cancelled" && <small>{uiText("Cancelled")}</small>}
        </article>)}
        {session.chat.error && <div className="ai-chat-error"><AiErrorFeedback error={session.chat.error} />
          <p>文脈が長すぎる場合は、新しい会話や会話の消去をご利用ください。</p>
          <button disabled={busy || session.pendingConnectionConfirmation || !session.available} onClick={() => void controller.send(session.id, session.lastQuestion)}>{uiText("Retry")}</button>
        </div>}
      </div>
      <footer>
        <textarea ref={inputRef} aria-label={uiText("AI Chat message")} value={session.draft} maxLength={CHAT_LIMITS.draftBytes} readOnly={!session.available}
          disabled={!configured || running} onChange={(event) => controller.draft(session.id, event.target.value)}
          onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}
          onKeyDown={(event) => { if (shouldSendChatKey(event.key, event.shiftKey, composing || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) {
            event.preventDefault(); void controller.send(session.id);
          } }} />
        {running ? <button onClick={() => controller.stop(session.id)}>{uiText("Cancel")}</button>
          : <button disabled={!configured || busy || session.pendingConnectionConfirmation || !session.available || !session.draft.trim()}
            onClick={() => void controller.send(session.id)}>{session.phase === "cancelling" ? "停止処理中…" : uiText("Send")}</button>}
      </footer>
    </section> : <p className="ai-chat-empty">会話がありません。＋で文書相談を追加できます。</p>}
    {!configured && <div className="ai-chat-error">
      {state.connectionError === undefined ? uiText("AI is not configured.") : <>
        <div role="alert">{uiText("AI settings could not be loaded.")}</div><ErrorDetails detail={state.connectionError} />
      </>}
      <button onClick={onOpenAiSettings}>{uiText("AI Settings")}</button>
    </div>}
  </aside>;
}
