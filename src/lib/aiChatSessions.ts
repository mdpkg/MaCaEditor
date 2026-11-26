import { createAiChatState, reduceAiChat, type AiChatState } from "./aiChat";
import type { RequestOwner } from "./chatTransport";
import type { AiError } from "../types";

export type ChatConnection = { revision: string; endpoint: string; model: string };
export type ChatPathChange = { from: string; to?: string };
export const CHAT_LIMITS = { sessions: 20, questionCharacters: 10000, draftBytes: 1024 * 1024,
  messages: 200, responseBytes: 64 * 1024, errorCodeUnits: 4096, errorBytes: 16 * 1024,
  retainedBytes: 8 * 1024 * 1024, requestBytes: 1024 * 1024 } as const;
export const utf8Bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const immutableTextSizes = new WeakMap<object, number>();
function textBytes(value: unknown): number {
  if (typeof value === "string") return utf8Bytes(value);
  if (value && typeof value === "object") {
    const cached = immutableTextSizes.get(value);
    if (cached !== undefined) return cached;
    const size = Object.values(value).reduce<number>((sum, item) => sum + textBytes(item), 0);
    immutableTextSizes.set(value, size);
    return size;
  }
  return 0;
}
export const retainedChatBytes = (state: AiChatSessionsState) => textBytes(state.sessions);
function reservedBytes(state: AiChatSessionsState) {
  return state.sessions.reduce((sum, session) => sum + (session.owner && !session.terminal
    ? CHAT_LIMITS.errorBytes + Math.max(0, CHAT_LIMITS.responseBytes - utf8Bytes(session.chat.messages[session.chat.messages.length - 1]?.content ?? "")) : 0), 0);
}
export type AiChatSession = {
  id: string; title: string; kind: "document"; path: string; available: boolean;
  chat: AiChatState; draft: string; generation: number; lastQuestion: string;
  scrollTop: number; follow: boolean;
  phase: "idle" | "starting" | "running" | "cancelling" | "error";
  owner?: RequestOwner; terminal?: boolean;
  approvedConnectionRevision?: string; pendingConnectionConfirmation: boolean;
};
export type AiChatSessionsState = {
  documentScopeKey: string; sessions: AiChatSession[]; selectedSessionId?: string; nextNumber: number;
  connection?: ChatConnection; connectionError?: string; notice?: string;
};
export type SessionAction =
  | { type: "paths"; changes: ChatPathChange[] }
  | { type: "notice"; message: string }
  | { type: "connectionError"; message: string }
  | { type: "add"; sessionId: string; path: string }
  | { type: "select" | "delete" | "clear" | "stop"; sessionId: string }
  | { type: "draft"; sessionId: string; value: string }
  | { type: "scroll"; sessionId: string; top: number; follow: boolean }
  | { type: "connection"; connection: ChatConnection }
  | { type: "confirm"; sessionId: string; revision: string }
  | { type: "begin"; owner: RequestOwner; question: string; retry?: boolean }
  | { type: "started" | "settled"; owner: RequestOwner }
  | { type: "delta" | "complete"; owner: RequestOwner; content: string }
  | { type: "fail"; owner: RequestOwner; error: AiError };
export type AiChatSessionsAction = SessionAction & { documentScopeKey: string };
export const createAiChatSessions = (documentScopeKey: string): AiChatSessionsState => ({ documentScopeKey, sessions: [], nextNumber: 1 });
export function sameRequest(a: RequestOwner | undefined, b: RequestOwner) {
  return a?.documentScopeKey === b.documentScopeKey && a.sessionId === b.sessionId && a.generation === b.generation && a.requestId === b.requestId;
}
export function reduceAiChatSessions(state: AiChatSessionsState, action: AiChatSessionsAction): AiChatSessionsState {
  const next = reduceSessions(state, action);
  if (retainedChatBytes(next) + reservedBytes(next) > CHAT_LIMITS.retainedBytes &&
      retainedChatBytes(next) + reservedBytes(next) > retainedChatBytes(state) + reservedBytes(state)) {
    if (action.type === "paths") return { ...state,
      sessions: state.sessions.map((session) => session.kind === "document" && session.available &&
        action.changes.some(({ from }) => session.path === from || session.path.startsWith(`${from}/`))
        ? { ...session, available: false } : session),
      notice: "保持量の上限により移動先を保持できない会話を読み取り専用にしました。不要な会話を削除・消去してください。",
    };
    return { ...state, notice: "会話の保持量が8MiBの上限に達します。不要な会話を削除・消去してください。" };
  }
  return next;
}
function reduceSessions(state: AiChatSessionsState, action: AiChatSessionsAction): AiChatSessionsState {
  if (action.documentScopeKey !== state.documentScopeKey) return state;
  if (action.type === "notice") return { ...state, notice: action.message };
  if (action.type === "connectionError") return { ...state, connectionError: action.message };
  if (action.type === "paths") {
    let changed = false;
    const sessions = state.sessions.map((session) => {
      if (session.kind !== "document" || !session.available) return session;
      const change = action.changes.find(({ from }) => session.path === from || session.path.startsWith(`${from}/`));
      if (!change) return session;
      changed = true;
      return change.to === undefined ? { ...session, available: false }
        : { ...session, path: change.to + session.path.slice(change.from.length) };
    });
    return changed ? { ...state, sessions } : state;
  }
  if (action.type === "connection") {
    if (state.connection?.revision === action.connection.revision) return state.connectionError ? { ...state, connectionError: undefined } : state;
    const revision = action.connection.revision;
    return { ...state, connection: action.connection, connectionError: undefined, sessions: state.sessions.map((session) => ({ ...session,
      approvedConnectionRevision: session.approvedConnectionRevision ?? (session.chat.messages.length ? undefined : revision),
      pendingConnectionConfirmation: (session.approvedConnectionRevision ?? (session.chat.messages.length ? undefined : revision)) !== revision,
      ...(session.owner && !session.terminal ? {
        generation: session.generation + 1, terminal: true, phase: "cancelling" as const,
        chat: reduceAiChat(session.chat, { type: "cancelled", requestId: session.owner.requestId }),
      } : {}),
    })) };
  }
  if (action.type === "add") {
    if (state.sessions.length >= CHAT_LIMITS.sessions) return { ...state, notice: "会話は文書あたり20件までです。" };
    if (state.sessions.some((session) => session.id === action.sessionId)) return state;
    const session: AiChatSession = {
      id: action.sessionId, title: `文書相談 ${state.nextNumber}`, kind: "document", path: action.path, available: true,
      chat: createAiChatState(), draft: "", generation: 0, lastQuestion: "", scrollTop: 0, follow: true, phase: "idle",
      approvedConnectionRevision: state.connection?.revision, pendingConnectionConfirmation: false,
    };
    return { ...state, sessions: [...state.sessions, session], selectedSessionId: session.id, nextNumber: state.nextNumber + 1 };
  }
  const sessionId = "owner" in action ? action.owner.sessionId : action.sessionId;
  const session = state.sessions.find((item) => item.id === sessionId);
  if (!session) return state;
  const update = (next: AiChatSession): AiChatSessionsState => ({ ...state, sessions: state.sessions.map((item) => item === session ? next : item) });
  if (action.type === "select") return { ...state, selectedSessionId: sessionId };
  if (action.type === "delete") {
    const index = state.sessions.indexOf(session), sessions = state.sessions.filter((item) => item !== session);
    return { ...state, sessions, selectedSessionId: state.selectedSessionId === sessionId
      ? sessions[Math.max(0, index - 1)]?.id : state.selectedSessionId };
  }
  if (action.type === "draft") return utf8Bytes(action.value) > CHAT_LIMITS.draftBytes
    ? { ...state, notice: "下書きは1MiB UTF-8までです。" } : update({ ...session, draft: action.value });
  if (action.type === "scroll") return update({ ...session, scrollTop: action.top, follow: action.follow });
  if (action.type === "confirm") return action.revision !== state.connection?.revision ? state : update({ ...session, approvedConnectionRevision: action.revision, pendingConnectionConfirmation: false });
  if (action.type === "clear" || action.type === "stop") {
    return update({ ...session, generation: session.generation + 1, terminal: true,
      phase: session.owner ? "cancelling" : "idle",
      chat: action.type === "clear" ? createAiChatState() : session.owner ? reduceAiChat(session.chat, { type: "cancelled", requestId: session.owner.requestId }) : session.chat,
      ...(action.type === "clear" ? { draft: "", lastQuestion: "" } : {}),
    });
  }
  if (action.type === "begin") {
    if (!action.question.trim() || Array.from(action.question).length > CHAT_LIMITS.questionCharacters ||
        session.chat.messages.length + (action.retry ? 0 : 2) > CHAT_LIMITS.messages) {
      return { ...state, notice: "質問は10,000 Unicode文字、会話は200メッセージまでです。新しい会話や会話の消去をご利用ください。" };
    }
    if (state.sessions.some((item) => item.owner) || !session.available || session.pendingConnectionConfirmation ||
        action.owner.documentScopeKey !== state.documentScopeKey || action.owner.generation !== session.generation + 1) return state;
    const requestId = action.owner.requestId;
    const chat = reduceAiChat(session.chat, action.retry ? { type: "retry", requestId, assistantId: `${requestId}:assistant` } : {
      type: "submit", requestId, assistantId: `${requestId}:assistant`, messageId: `${requestId}:user`, content: action.question,
    });
    return update({ ...session, chat, owner: action.owner, terminal: false, phase: "starting", generation: action.owner.generation, lastQuestion: action.question, draft: "" });
  }
  if (!("owner" in action) || !sameRequest(session.owner, action.owner)) return state;
  if (action.type === "settled") return update({ ...session, owner: undefined, phase: session.phase === "cancelling" ? "idle" : session.phase });
  if (session.terminal || session.generation !== action.owner.generation) return state;
  if (action.type === "started") return update({ ...session, phase: "running" });
  const requestId = action.owner.requestId;
  if ((action.type === "delta" || action.type === "complete") &&
      utf8Bytes(action.content) + (action.type === "delta" ? utf8Bytes(session.chat.messages[session.chat.messages.length - 1]?.content ?? "") : 0) > CHAT_LIMITS.responseBytes) {
    return update({ ...session, owner: undefined, terminal: true, phase: "error", chat: reduceAiChat(session.chat,
      { type: "error", requestId, error: { kind: "InvalidResponse", message: "回答が64KiB UTF-8を超えました。" } }) });
  }
  if (action.type === "delta") return update({ ...session, chat: reduceAiChat(session.chat, { type: "delta", requestId, content: action.content }) });
  if (action.type === "complete") return update({ ...session, owner: undefined, terminal: true, phase: "idle", chat: reduceAiChat(session.chat, { type: "completed", requestId, content: action.content }) });
  if (action.type === "fail") {
    const error = action.error.kind === "Cancelled" ? action.error : { ...action.error, message: action.error.message.slice(0, CHAT_LIMITS.errorCodeUnits) };
    return update({ ...session, owner: undefined, terminal: true, phase: "error", chat: reduceAiChat(session.chat, { type: "error", requestId, error }) });
  }
  return state;
}
