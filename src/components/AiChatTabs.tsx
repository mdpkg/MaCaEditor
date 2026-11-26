import { useId, useLayoutEffect, useRef, useState } from "react";
import type { AiChatSession } from "../lib/aiChatSessions";
export const chatTabId = (id: string) => `ai-chat-tab-${id}`;
export const chatPanelId = (id: string) => `ai-chat-panel-${id}`;
type Props = { sessions: AiChatSession[]; selectedId?: string; canAdd: boolean; focusRequest?: number;
  onSelect(id: string): void; onDelete(id: string): void; onAdd(): void };
export function AiChatTabs({ sessions, selectedId, canAdd, focusRequest = 0, onSelect, onDelete, onAdd }: Props) {
  const [focusedId, setFocusedId] = useState(selectedId);
  const refs = useRef(new Map<string, HTMLButtonElement>()), addRef = useRef<HTMLButtonElement>(null);
  const previousFocusRequest = useRef(focusRequest);
  const reasonId = useId();
  const focusId = sessions.some((session) => session.id === focusedId) ? focusedId : selectedId ?? sessions[0]?.id;
  const reason = !canAdd ? "Markdownを選ぶと追加できます。" : sessions.length >= 20 ? "会話は20件までです。不要な会話を削除してください。" : undefined;
  useLayoutEffect(() => {
    setFocusedId(selectedId);
    if (selectedId) refs.current.get(selectedId)?.parentElement?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [selectedId]);
  useLayoutEffect(() => {
    if (previousFocusRequest.current === focusRequest) return;
    previousFocusRequest.current = focusRequest;
    (selectedId ? refs.current.get(selectedId) : addRef.current)?.focus();
  }, [focusRequest, selectedId]);
  return <>
    <div className="ai-chat-tab-toolbar"><div role="tablist" aria-label="AIチャットの会話" className="ai-chat-tabs">
      {sessions.map((session, index) => {
        const status = session.phase === "starting" ? "接続中" : session.phase === "running" ? "生成中" : session.phase === "cancelling" ? "停止処理中" : session.phase === "error" ? "エラー" : "";
        return <div key={session.id} className="ai-chat-tab-item">
          <button ref={(element) => { if (element) refs.current.set(session.id, element); else refs.current.delete(session.id); }}
            role="tab" id={chatTabId(session.id)} aria-controls={chatPanelId(session.id)} aria-selected={selectedId === session.id}
            tabIndex={focusId === session.id ? 0 : -1} className="ai-chat-tab" title={session.title}
            onFocus={() => setFocusedId(session.id)} onClick={() => onSelect(session.id)} onKeyDown={(event) => {
              let target = index;
              if (event.key === "ArrowRight") target = (index + 1) % sessions.length;
              else if (event.key === "ArrowLeft") target = (index + sessions.length - 1) % sessions.length;
              else if (event.key === "Home") target = 0;
              else if (event.key === "End") target = sessions.length - 1;
              else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(session.id); return; }
              else return;
              event.preventDefault(); refs.current.get(sessions[target].id)?.focus();
            }}>
            <span>{session.title}</span>{status && <small>（{status}）</small>}
          </button>
          <button className="ai-chat-tab-delete" aria-label={`${session.title}を削除`} onClick={() => onDelete(session.id)}>×</button>
        </div>;
      })}
    </div><button ref={addRef} aria-label="文書相談を追加" aria-disabled={!!reason} aria-describedby={reason ? reasonId : undefined}
      className="ai-chat-tab-add" onClick={() => { if (!reason) onAdd(); }}>＋</button></div>
    {reason && <p id={reasonId} className="ai-chat-tab-reason">{reason}</p>}
  </>;
}
