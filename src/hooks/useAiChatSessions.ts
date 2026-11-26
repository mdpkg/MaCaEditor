import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ChatSessionsController } from "../lib/chatSessionsController";
import { cancelAiRequest, loadChatConnection, startAiDocumentChat, startAiQuotedChat } from "../lib/tauri";
import { readAiError } from "../lib/aiSelection";
import { isChatTransportBusy, subscribeChatTransport } from "../lib/chatTransport";

export function useAiChatSessions(scope: string | null, document: (scope: string, path: string) => string | undefined) {
  const source = useRef(document); source.current = document;
  const [stored, setStored] = useState<ChatSessionsController>();
  const controller = stored?.scope === scope ? stored : undefined;
  const phase = useSyncExternalStore(controller?.subscribe ?? (() => () => {}), controller?.getActivitySnapshot ?? (() => "idle"));
  const busy = useSyncExternalStore(subscribeChatTransport, isChatTransportBusy);
  useEffect(() => {
    if (scope === null) { setStored(undefined); return; }
    const instance = new ChatSessionsController(scope, { connection: () => loadChatConnection(),
      document: (path) => source.current(scope, path), send: startAiDocumentChat, sendQuote: startAiQuotedChat, cancel: cancelAiRequest, error: readAiError });
    setStored(instance); void instance.refreshConnection();
    const refresh = () => { void instance.refreshConnection(); };
    window.addEventListener("focus", refresh);
    return () => { window.removeEventListener("focus", refresh); instance.dispose(); };
  }, [scope]);
  return { controller, phase, busy };
}
