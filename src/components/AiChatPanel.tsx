import { uiText } from "../lib/uiText";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AiConfig, AiError, AiStreamEvent } from "../types";
import { isAiConfigured, readAiError } from "../lib/aiSelection";
import { AiErrorFeedback } from "./AiErrorFeedback";
import { ErrorDetails } from "./ErrorDetails";
import { chatHistory, createAiChatState, reduceAiChat, shouldSendChatKey } from "../lib/aiChat";
import { cancelAiRequest, loadAiConfig, startAiDocumentChat } from "../lib/tauri";
import { ChatTransport } from "../lib/chatTransport";

type Props = { filename: string; currentDocument: string; onClose: () => void; onOpenAiSettings: () => void };
const nextId = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

export function AiChatPanel({ filename, currentDocument, onClose, onOpenAiSettings }: Props) {
  const [state, dispatch] = useReducer(reduceAiChat, undefined, createAiChatState);
  const [input, setInput] = useState("");
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [invokeError, setInvokeError] = useState<AiError | null>(null);
  const [starting, setStarting] = useState(false);
  const [composing, setComposing] = useState(false);
  const activeRef = useRef<string>();
  const transportRef = useRef<ChatTransport>();
  const listRef = useRef<HTMLDivElement>(null);
  const lastQuestionRef = useRef("");

  useEffect(() => {
    loadAiConfig().then(setConfig).catch((reason: unknown) => {
      setLoadError(reason instanceof Error ? reason.message : String(reason));
    });
  }, []);
  useEffect(() => () => { transportRef.current?.invalidate(); activeRef.current = undefined; }, []);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    if (nearBottom) list.scrollTop = list.scrollHeight;
  }, [state.messages]);

  const configured = useMemo(() => config !== null && isAiConfigured(config), [config]);
  const send = async (text = input) => {
    const question = text.trim();
    if (!question || activeRef.current || transportRef.current?.busy || starting || state.status === "running" || !config || !isAiConfigured(config)) return;
    const history = chatHistory(state.messages);
    const retrying = state.status === "error" && lastQuestionRef.current === question;
    const requestId = nextId();
    activeRef.current = requestId;
    lastQuestionRef.current = question;
    setInput(""); setInvokeError(null); setStarting(true);
    dispatch(retrying
      ? { type: "retry", requestId, assistantId: nextId() }
      : { type: "submit", requestId, messageId: nextId(), assistantId: nextId(), content: question });
    const onEvent = (event: AiStreamEvent) => {
      if (event.type === "delta") dispatch({ type: "delta", requestId: event.request_id, content: event.content });
    };
    const transport = new ChatTransport((id, deliver) => startAiDocumentChat({
      requestId: id, baseUrl: config.base_url, apiKey: config.api_key, model: config.model,
      filename, currentDocument, history, question,
      connectTimeoutSeconds: config.connect_timeout_seconds,
      requestTimeoutSeconds: config.request_timeout_seconds,
    }, deliver), cancelAiRequest);
    transportRef.current = transport;
    try {
      const result = await transport.send({ documentScopeKey: "single-chat", sessionId: filename, generation: 0, requestId }, onEvent);
      if (result && activeRef.current === requestId) dispatch({ type: "completed", requestId, content: result.content });
    } catch (reason) {
      if (activeRef.current === requestId) dispatch({ type: "error", requestId, error: readAiError(reason) });
    } finally {
      if (activeRef.current === requestId) activeRef.current = undefined;
      setStarting(false);
    }
  };
  const cancel = async () => {
    const requestId = activeRef.current;
    activeRef.current = undefined;
    transportRef.current?.invalidate();
    if (requestId) dispatch({ type: "cancelled", requestId });
  };
  const clear = async () => { await cancel(); activeRef.current = undefined; setInvokeError(null); dispatch({ type: "clear" }); };
  const close = async () => { await cancel(); onClose(); };
  const error = starting ? null : invokeError ?? state.error;

  return <aside className="ai-chat-panel" aria-label={uiText("AI Chat")}>
    <header><strong>{uiText("AI Chat")}</strong><div><button disabled={starting} onClick={() => void clear()}>{uiText("Clear")}</button><button aria-label={uiText("Close AI Chat")} onClick={() => void close()}>×</button></div></header>
    <div className="ai-chat-document" title={filename}>{filename}</div>
    <div className="ai-chat-messages" ref={listRef}>
      {state.messages.length === 0 && <p className="ai-chat-empty">{uiText("Ask about the current Markdown document.")}</p>}
      {state.messages.map((message) => <article key={message.id} className={`ai-chat-message ai-chat-${message.role}`}>
        <b>{message.role === "user" ? uiText("You") : "AI"}</b>
        {message.role === "user" ? <p>{message.content}</p> : <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>}
        {message.status === "complete" && !message.content.trim() &&
          <p role="status">{uiText("AI returned no text.")}</p>}
        {message.status === "streaming" && <small>{uiText("Generating…")}</small>}
        {message.status === "cancelled" && <small>{uiText("Cancelled")}</small>}
      </article>)}
      {error && <div className="ai-chat-error">
        <AiErrorFeedback error={error} />
        <button onClick={() => void send(lastQuestionRef.current)}>{uiText("Retry")}</button>
      </div>}
    </div>
    {!configured && <div className="ai-chat-error">
      {loadError === null ? uiText("AI is not configured.") : <>
        <div role="alert">{uiText("AI settings could not be loaded.")}</div>
        <ErrorDetails detail={loadError} />
      </>}
      {" "}<button onClick={onOpenAiSettings}>{uiText("AI Settings")}</button>
    </div>}
    <footer>
      <textarea aria-label={uiText("AI Chat message")} value={input} disabled={!configured || starting || state.status === "running"}
        onChange={(event) => setInput(event.target.value)} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}
        onKeyDown={(event) => { if (shouldSendChatKey(event.key, event.shiftKey, composing || event.nativeEvent.isComposing)) { event.preventDefault(); void send(); } }} />
      {state.status === "running" ? <button onClick={() => void cancel()}>{uiText("Cancel")}</button> : <button disabled={!configured || starting || !input.trim()} onClick={() => void send()}>{starting ? "停止処理中…" : uiText("Send")}</button>}
    </footer>
  </aside>;
}
