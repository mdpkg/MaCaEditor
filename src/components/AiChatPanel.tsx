import { uiText } from "../lib/uiText";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AiConfig, AiError, AiStreamEvent } from "../types";
import { isAiConfigured, readAiError } from "../lib/aiSelection";
import { AiErrorFeedback } from "./AiErrorFeedback";
import { chatHistory, createAiChatState, reduceAiChat, shouldSendChatKey } from "../lib/aiChat";
import { cancelAiRequest, loadAiConfig, startAiDocumentChat } from "../lib/tauri";

type Props = { filename: string; currentDocument: string; onClose: () => void; onOpenAiSettings: () => void };
const nextId = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

export function AiChatPanel({ filename, currentDocument, onClose, onOpenAiSettings }: Props) {
  const [state, dispatch] = useReducer(reduceAiChat, undefined, createAiChatState);
  const [input, setInput] = useState("");
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [invokeError, setInvokeError] = useState<AiError | null>(null);
  const [starting, setStarting] = useState(false);
  const [composing, setComposing] = useState(false);
  const activeRef = useRef<string>();
  const listRef = useRef<HTMLDivElement>(null);
  const lastQuestionRef = useRef("");

  useEffect(() => { loadAiConfig().then(setConfig).catch(() => setLoadFailed(true)); }, []);
  useEffect(() => () => { if (activeRef.current) void cancelAiRequest(activeRef.current); }, []);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    if (nearBottom) list.scrollTop = list.scrollHeight;
  }, [state.messages]);

  const configured = useMemo(() => config !== null && isAiConfigured(config), [config]);
  const send = async (text = input) => {
    const question = text.trim();
    if (!question || starting || state.status === "running" || !config || !isAiConfigured(config)) return;
    const history = chatHistory(state.messages);
    const lastHistory = history[history.length - 1];
    const retrying = state.status === "error" && lastQuestionRef.current === question &&
      lastHistory?.role === "User" && lastHistory.content === question;
    if (retrying) history.pop();
    lastQuestionRef.current = question;
    setInput(""); setInvokeError(null); setStarting(true);
    let started = false;
    const onEvent = (event: AiStreamEvent) => {
      if (event.type === "started") {
        started = true; activeRef.current = event.request_id;
        dispatch(retrying
          ? { type: "retry", requestId: event.request_id, assistantId: nextId() }
          : { type: "submit", requestId: event.request_id, messageId: nextId(), assistantId: nextId(), content: question });
      } else if (event.type === "delta") dispatch({ type: "delta", requestId: event.request_id, content: event.content });
      else if (event.type === "completed") { activeRef.current = undefined; dispatch({ type: "completed", requestId: event.request_id }); }
      else if (event.type === "cancelled") { activeRef.current = undefined; dispatch({ type: "cancelled", requestId: event.request_id }); }
      else { activeRef.current = undefined; dispatch({ type: "error", requestId: event.request_id, error: readAiError(event.error) }); }
    };
    try {
      await startAiDocumentChat({
        baseUrl: config.base_url, apiKey: config.api_key, model: config.model,
        filename, currentDocument, history, question,
        connectTimeoutSeconds: config.connect_timeout_seconds,
        requestTimeoutSeconds: config.request_timeout_seconds,
      }, onEvent);
    } catch (reason) {
      if (!started) setInvokeError(readAiError(reason));
    } finally {
      setStarting(false);
    }
  };
  const cancel = async () => { if (activeRef.current) await cancelAiRequest(activeRef.current); };
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
        {message.status === "streaming" && <small>{uiText("Generating…")}</small>}
        {message.status === "cancelled" && <small>{uiText("Cancelled")}</small>}
      </article>)}
      {error && <div className="ai-chat-error">
        <AiErrorFeedback error={error} />
        <button onClick={() => void send(lastQuestionRef.current)}>{uiText("Retry")}</button>
      </div>}
    </div>
    {!configured && <div className="ai-chat-error">{loadFailed ? uiText("AI settings could not be loaded.") : uiText("AI is not configured.")} <button onClick={onOpenAiSettings}>{uiText("AI Settings")}</button></div>}
    <footer>
      <textarea aria-label={uiText("AI Chat message")} value={input} disabled={!configured || starting || state.status === "running"}
        onChange={(event) => setInput(event.target.value)} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}
        onKeyDown={(event) => { if (shouldSendChatKey(event.key, event.shiftKey, composing || event.nativeEvent.isComposing)) { event.preventDefault(); void send(); } }} />
      {state.status === "running" ? <button onClick={() => void cancel()}>{uiText("Cancel")}</button> : <button disabled={!configured || starting || !input.trim()} onClick={() => void send()}>{uiText("Send")}</button>}
    </footer>
  </aside>;
}
