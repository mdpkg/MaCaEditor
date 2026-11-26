import type { AiError, AiMessage } from "../types";

export type AiChatMessageStatus = "streaming" | "complete" | "cancelled" | "failed";
export type AiChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status?: AiChatMessageStatus;
  requestId?: string;
};
export type AiChatState = {
  messages: AiChatMessage[];
  status: "idle" | "running" | "error";
  activeRequestId?: string;
  error?: AiError;
};
export type AiChatAction =
  | { type: "submit"; requestId: string; messageId: string; assistantId: string; content: string }
  | { type: "retry"; requestId: string; assistantId: string }
  | { type: "delta"; requestId: string; content: string }
  | { type: "completed"; requestId: string; content?: string }
  | { type: "cancelled"; requestId: string }
  | { type: "error"; requestId: string; error: AiError }
  | { type: "clear" };

export const createAiChatState = (): AiChatState => ({ messages: [], status: "idle" });

export function reduceAiChat(state: AiChatState, action: AiChatAction): AiChatState {
  if (action.type === "clear") return createAiChatState();
  if (action.type === "submit") {
    return {
      messages: [
        ...state.messages,
        { id: action.messageId, role: "user", content: action.content },
        { id: action.assistantId, role: "assistant", content: "", status: "streaming", requestId: action.requestId },
      ],
      status: "running",
      activeRequestId: action.requestId,
    };
  }
  if (action.type === "retry") return {
    messages: [
      ...state.messages.filter((message, index) => index !== state.messages.length - 1 || message.status !== "failed"),
      { id: action.assistantId, role: "assistant", content: "", status: "streaming", requestId: action.requestId },
    ],
    status: "running", activeRequestId: action.requestId,
  };
  if (state.activeRequestId !== action.requestId || state.status !== "running") return state;
  const updateAssistant = (changes: Partial<AiChatMessage>) => state.messages.map((message) =>
    message.role === "assistant" && message.requestId === action.requestId
      ? { ...message, ...changes }
      : message
  );
  if (action.type === "delta") {
    return { ...state, messages: updateAssistant({
      content: `${state.messages.find((m) => m.requestId === action.requestId)?.content ?? ""}${action.content}`,
    }) };
  }
  if (action.type === "completed") {
    return { messages: updateAssistant({ status: "complete", ...(action.content === undefined ? {} : { content: action.content }) }), status: "idle" };
  }
  if (action.type === "cancelled") {
    return { messages: updateAssistant({ status: "cancelled" }), status: "idle" };
  }
  if (action.type === "error") return {
    messages: updateAssistant({ status: "failed" }), status: "error", error: action.error,
  };
  return state;
}

/** Only complete user/assistant pairs belong to API history. */
export function chatHistory(messages: AiChatMessage[]): AiMessage[] {
  const history: AiMessage[] = [];
  for (let index = 0; index + 1 < messages.length; index++) {
    const user = messages[index], assistant = messages[index + 1];
    if (user.role === "user" && assistant.role === "assistant" && assistant.status === "complete") {
      history.push({ role: "User", content: user.content }, { role: "Assistant", content: assistant.content });
      index++;
    }
  }
  return history;
}

export function canSendChat(input: string, running: boolean, hasMarkdown: boolean, configured: boolean): boolean {
  return input.trim().length > 0 && !running && hasMarkdown && configured;
}

export function shouldSendChatKey(key: string, shiftKey: boolean, composing: boolean): boolean {
  return key === "Enter" && !shiftKey && !composing;
}
