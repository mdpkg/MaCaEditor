import { createAiChatState, type AiChatState } from "./aiChat";

export type AiChatSession = {
  id: string; title: string; kind: "document"; path: string; available: boolean;
  chat: AiChatState; draft: string; generation: number; lastQuestion: string;
  scrollTop: number; follow: boolean;
  approvedConnectionRevision?: string; pendingConnectionConfirmation: boolean;
};
export type AiChatSessionsState = {
  documentScopeKey: string; sessions: AiChatSession[]; selectedSessionId?: string; nextNumber: number;
};
type SessionAction =
  | { type: "add"; sessionId: string; path: string }
  | { type: "select" | "delete"; sessionId: string }
  | { type: "draft"; sessionId: string; value: string };
export type AiChatSessionsAction = SessionAction & { documentScopeKey: string };
export const createAiChatSessions = (documentScopeKey: string): AiChatSessionsState => ({ documentScopeKey, sessions: [], nextNumber: 1 });
export function reduceAiChatSessions(state: AiChatSessionsState, action: AiChatSessionsAction): AiChatSessionsState {
  if (action.documentScopeKey !== state.documentScopeKey) return state;
  if (action.type === "add") {
    if (state.sessions.some((session) => session.id === action.sessionId)) return state;
    const session: AiChatSession = {
      id: action.sessionId, title: `文書相談 ${state.nextNumber}`, kind: "document", path: action.path, available: true,
      chat: createAiChatState(), draft: "", generation: 0, lastQuestion: "", scrollTop: 0, follow: true,
      pendingConnectionConfirmation: false,
    };
    return { ...state, sessions: [...state.sessions, session], selectedSessionId: session.id, nextNumber: state.nextNumber + 1 };
  }
  if (!state.sessions.some((session) => session.id === action.sessionId)) return state;
  if (action.type === "select") return { ...state, selectedSessionId: action.sessionId };
  if (action.type === "delete") {
    const index = state.sessions.findIndex((session) => session.id === action.sessionId);
    const sessions = state.sessions.filter((session) => session.id !== action.sessionId);
    return { ...state, sessions, selectedSessionId: state.selectedSessionId === action.sessionId
      ? sessions[Math.max(0, index - 1)]?.id : state.selectedSessionId };
  }
  return { ...state, sessions: state.sessions.map((session) => session.id === action.sessionId ? { ...session, draft: action.value } : session) };
}
