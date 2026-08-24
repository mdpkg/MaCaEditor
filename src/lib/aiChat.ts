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
  | { type: "delta"; requestId: string; content: string }
  | { type: "completed" | "cancelled"; requestId: string }
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
    return { messages: updateAssistant({ status: "complete" }), status: "idle" };
  }
  if (action.type === "cancelled") {
    return { messages: updateAssistant({ status: "cancelled" }), status: "idle" };
  }
  return {
    messages: updateAssistant({ status: "failed" }), status: "error", error: action.error,
  };
}

/** API には user と正常完了した assistant のみを渡す。 */
export function chatHistory(messages: AiChatMessage[]): AiMessage[] {
  return messages.flatMap((message) => {
    if (message.role === "assistant" && message.status !== "complete") return [];
    return [{ role: message.role === "user" ? "User" as const : "Assistant" as const, content: message.content }];
  });
}
