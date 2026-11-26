import { useCallback, useEffect, useRef, useState } from "react";
import { loadChachaPreferences } from "../lib/chachaPreferences";
import { ChachaSession } from "../lib/chachaSession";
import { normalizeChachaSettings, type ChachaSettings } from "../lib/chachaSettings";
import { loadChachaConnection, requestChacha, type ChachaConnection } from "../lib/chachaTransport";
import type { QuotedChat } from "../lib/quotedChat";

export interface ChachaRuntime {
  key: string;
  session: ChachaSession;
  connection: { current: ChachaConnection | undefined };
}

export function useChachaRuntime(key: string | null, scope?: string, onContinue?: (quote: QuotedChat) => boolean) {
  const handoff = useRef({ scope, onContinue }); handoff.current = { scope, onContinue };
  const [settings, setSettings] = useState(normalizeChachaSettings);
  const [ready, setReady] = useState(false);
  const [storedRuntime, setRuntime] = useState<ChachaRuntime>();
  const settingsRef = useRef(settings), version = useRef(0);
  const runtime = storedRuntime?.key === key ? storedRuntime : undefined;
  const activeRef = useRef(runtime); activeRef.current = runtime;
  useEffect(() => {
    let alive = true; const initialVersion = version.current;
    void loadChachaPreferences().then((value) => {
      if (alive && version.current === initialVersion) { settingsRef.current = value; setSettings(value); setReady(true); }
    });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (!key || !ready) { setRuntime(undefined); return; }
    const connection: ChachaRuntime["connection"] = { current: undefined };
    const session: ChachaSession = new ChachaSession(settingsRef.current, (request) => requestChacha({ ...request, connectionRevision: request.connectionRevision ?? connection.current?.revision ?? "" }), {
      capture: () => connection.current && handoff.current.scope ? { documentScopeKey: handoff.current.scope, connection: connection.current } : undefined,
      onContinue: (quote) => activeRef.current?.session === session && handoff.current.scope === quote.documentScopeKey && handoff.current.onContinue?.(quote) === true,
    });
    const instance = { key, session, connection }; setRuntime(instance);
    return () => { if (activeRef.current === instance) activeRef.current = undefined; session.dispose(); };
  }, [key, ready]);
  const applySettings = useCallback((value: ChachaSettings) => {
    const next = normalizeChachaSettings(value); version.current++; settingsRef.current = next;
    activeRef.current?.session.configure(next); setSettings(next); setReady(true);
  }, []);
  const connectionSaved = useCallback(async () => {
    const current = activeRef.current; if (!current) return;
    current.session.dismiss();
    try {
      const connection = await loadChachaConnection();
      if (activeRef.current === current && current.connection.current && current.connection.current.revision !== connection.revision) {
        current.connection.current = undefined; current.session.connectionChanged();
      }
    } catch { if (activeRef.current === current) { current.connection.current = undefined; current.session.connectionChanged(); } }
  }, []);
  return { runtime, settings, applySettings, connectionSaved };
}
