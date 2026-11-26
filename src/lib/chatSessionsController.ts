import type { AiError, AiMessage, AiStreamEvent } from "../types";
import { chatHistory } from "./aiChat";
import { createAiChatSessions, reduceAiChatSessions, CHAT_LIMITS, utf8Bytes, sameRequest,
  type SessionAction, type ChatConnection } from "./aiChatSessions";
import { ChatTransport, isChatTransportBusy, type ChatCompletion, type RequestOwner } from "./chatTransport";
export type DocumentChatRequest = { requestId: string; expectedConnection: string; filename: string;
  currentDocument: string; history: AiMessage[]; question: string };
type Dependencies = {
  connection(): Promise<ChatConnection>; document(path: string): string | undefined;
  send(request: DocumentChatRequest, deliver: (event: AiStreamEvent) => void): Promise<ChatCompletion>;
  cancel(id: string): Promise<boolean>; error?(reason: unknown): AiError;
};
/** Memory-only document owner. The physical transport remains application-scoped. */
export class ChatSessionsController {
  private state;
  private disposed = false;
  private connectionGeneration = 0;
  private initialized = false;
  private transport?: ChatTransport;
  private readonly listeners = new Set<() => void>();
  constructor(readonly scope: string, private readonly dependencies: Dependencies) { this.state = createAiChatSessions(scope); }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private dispatch(action: SessionAction) {
    if (this.disposed) return;
    const next = reduceAiChatSessions(this.state, { ...action, documentScopeKey: this.scope });
    if (next !== this.state) { this.state = next; this.listeners.forEach((listener) => listener()); }
  }
  private notice(message: string) { this.dispatch({ type: "notice", message }); }
  initialize(path: string) { if (!this.initialized) { this.initialized = true; this.add(path); } }
  add(path: string): string | undefined {
    const sessionId = crypto.randomUUID();
    this.dispatch({ type: "add", sessionId, path });
    return this.state.sessions.some((session) => session.id === sessionId) ? sessionId : undefined;
  }
  select(sessionId: string) { this.dispatch({ type: "select", sessionId }); }
  draft(sessionId: string, value: string) { this.dispatch({ type: "draft", sessionId, value }); }
  scroll(sessionId: string, top: number, follow: boolean) { this.dispatch({ type: "scroll", sessionId, top, follow }); }
  confirm(sessionId: string, revision: string) { this.dispatch({ type: "confirm", sessionId, revision }); }
  private invalidate(sessionId: string, type: "stop" | "clear" | "delete") {
    const owned = this.state.sessions.find((session) => session.id === sessionId)?.owner;
    this.dispatch({ type, sessionId });
    if (owned) this.transport?.invalidate();
  }
  stop(sessionId: string) { this.invalidate(sessionId, "stop"); }
  clear(sessionId: string) { this.invalidate(sessionId, "clear"); }
  delete(sessionId: string) { this.invalidate(sessionId, "delete"); }
  async refreshConnection() {
    const generation = ++this.connectionGeneration;
    try {
      const connection = await this.dependencies.connection();
      if (this.disposed || generation !== this.connectionGeneration) return;
      const changed = this.state.connection !== undefined && this.state.connection.revision !== connection.revision;
      this.dispatch({ type: "connection", connection });
      if (changed) this.transport?.invalidate();
    } catch (reason) {
      if (this.disposed || generation !== this.connectionGeneration) return;
      for (const session of this.state.sessions) if (session.owner) this.stop(session.id);
      this.dispatch({ type: "connectionError", message: String(reason).slice(0, CHAT_LIMITS.errorCodeUnits) });
    }
  }
  async send(sessionId: string, input?: string) {
    const session = this.state.sessions.find((item) => item.id === sessionId);
    const connection = this.state.connection;
    if (this.disposed || !session || !connection || this.state.connectionError || !session.available || session.pendingConnectionConfirmation || isChatTransportBusy()) return;
    const question = (input ?? session.draft).trim();
    const currentDocument = this.dependencies.document(session.path);
    if (currentDocument === undefined) { this.notice("対象Markdownがありません。この会話からは送信できません。"); return; }
    const owner: RequestOwner = { documentScopeKey: this.scope, sessionId, generation: session.generation + 1, requestId: crypto.randomUUID() };
    const request: DocumentChatRequest = { requestId: owner.requestId, expectedConnection: session.approvedConnectionRevision ?? connection.revision,
      filename: session.path, currentDocument, history: chatHistory(session.chat.messages), question };
    if (utf8Bytes(JSON.stringify(request)) > CHAT_LIMITS.requestBytes) { this.notice("送信内容が1MiBの上限を超えます。新しい会話や会話の消去をご利用ください。"); return; }
    this.dispatch({ type: "begin", owner, question, retry: session.chat.status === "error" && session.lastQuestion === question });
    if (!sameRequest(this.state.sessions.find((item) => item.id === sessionId)?.owner, owner)) return;
    const transport = new ChatTransport((_, deliver) => this.dependencies.send(request, deliver), this.dependencies.cancel);
    this.transport = transport;
    try {
      const result = await transport.send(owner, (event) => {
        if (event.type === "started") this.dispatch({ type: "started", owner });
        if (event.type === "delta") this.dispatch({ type: "delta", owner, content: event.content });
      });
      if (result) this.dispatch({ type: "complete", owner, content: result.content });
    } catch (reason) {
      const current = this.state.sessions.find((item) => item.id === sessionId);
      const owned = !!current && sameRequest(current.owner, owner) && !current.terminal && current.generation === owner.generation;
      let error = this.dependencies.error?.(reason) ?? { kind: "Unknown" as const, message: String(reason) };
      if (error.kind !== "Cancelled") error = { ...error, message: error.message.slice(0, CHAT_LIMITS.errorCodeUnits) };
      this.dispatch({ type: "fail", owner, error });
      if (owned && reason && typeof reason === "object" && "message" in reason && reason.message === "chat_connection_changed") {
        if (!this.disposed && this.state.sessions.find((item) => item.id === sessionId)?.draft === "") this.draft(sessionId, question);
        await this.refreshConnection();
      }
    } finally {
      if (this.transport === transport) this.transport = undefined;
      this.dispatch({ type: "settled", owner });
    }
  }
  dispose() {
    for (const session of this.state.sessions) if (session.owner) this.stop(session.id);
    this.state = createAiChatSessions(this.scope);
    this.disposed = true; this.listeners.clear();
  }
}
