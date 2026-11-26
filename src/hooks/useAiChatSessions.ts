import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ChatSessionsController } from "../lib/chatSessionsController";
import { createAiChatSessions } from "../lib/aiChatSessions";
import { cancelAiRequest, loadChatConnection, startAiDocumentChat } from "../lib/tauri";
import { readAiError } from "../lib/aiSelection";
import { isChatTransportBusy, subscribeChatTransport } from "../lib/chatTransport";

export function useAiChatSessions(scope: string | null, document: (scope: string, path: string) => string | undefined) {
  const source = useRef(document); source.current = document;
  const [stored, setStored] = useState<ChatSessionsController>();
  const controller = stored?.scope === scope ? stored : undefined;
  const empty = useMemo(() => createAiChatSessions(scope ?? "closed"), [scope]);
  const state = useSyncExternalStore(controller?.subscribe ?? (() => () => {}), controller?.getSnapshot ?? (() => empty));
  const busy = useSyncExternalStore(subscribeChatTransport, isChatTransportBusy);
  useEffect(() => {
    if (scope === null) { setStored(undefined); return; }
    const instance = new ChatSessionsController(scope, { connection: () => loadChatConnection(),
      document: (path) => source.current(scope, path), send: startAiDocumentChat, cancel: cancelAiRequest, error: readAiError });
    setStored(instance); void instance.refreshConnection();
    const refresh = () => { void instance.refreshConnection(); };
    window.addEventListener("focus", refresh);
    return () => { window.removeEventListener("focus", refresh); instance.dispose(); };
  }, [scope]);
  return { controller, state, busy };
}
