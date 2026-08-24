import { describe, expect, test } from "vitest";
import { canSendChat, chatHistory, createAiChatState, reduceAiChat, shouldSendChatKey } from "./aiChat";

describe("AI chat state", () => {
  test("starts empty and appends a user plus one assistant placeholder", () => {
    let state = createAiChatState();
    expect(state).toMatchObject({ messages: [], status: "idle" });
    state = reduceAiChat(state, { type: "submit", requestId: "a", messageId: "u", assistantId: "x", content: "hello" });
    expect(state.messages.map((m) => [m.role, m.content])).toEqual([["user", "hello"], ["assistant", ""]]);
    expect(state.status).toBe("running");
  });

  test("accumulates deltas in one assistant and completes", () => {
    let state = reduceAiChat(createAiChatState(), { type: "submit", requestId: "a", messageId: "u", assistantId: "x", content: "hello" });
    state = reduceAiChat(state, { type: "delta", requestId: "a", content: "Hello" });
    state = reduceAiChat(state, { type: "delta", requestId: "a", content: " world" });
    state = reduceAiChat(state, { type: "completed", requestId: "a" });
    expect(state.messages.filter((m) => m.role === "assistant")).toHaveLength(1);
    expect(state.messages[1]).toMatchObject({ content: "Hello world", status: "complete" });
    expect(state.status).toBe("idle");
  });

  test("cancel keeps partial output but ignores later events and excludes it from API history", () => {
    let state = reduceAiChat(createAiChatState(), { type: "submit", requestId: "a", messageId: "u", assistantId: "x", content: "hello" });
    state = reduceAiChat(state, { type: "delta", requestId: "a", content: "partial" });
    state = reduceAiChat(state, { type: "cancelled", requestId: "a" });
    state = reduceAiChat(state, { type: "delta", requestId: "a", content: " stale" });
    state = reduceAiChat(state, { type: "completed", requestId: "a" });
    expect(state.messages[1]).toMatchObject({ content: "partial", status: "cancelled" });
    expect(chatHistory(state.messages)).toEqual([{ role: "User", content: "hello" }]);
  });

  test("ignores request A after request B becomes active", () => {
    let state = reduceAiChat(createAiChatState(), { type: "submit", requestId: "a", messageId: "u1", assistantId: "x1", content: "one" });
    state = reduceAiChat(state, { type: "cancelled", requestId: "a" });
    state = reduceAiChat(state, { type: "submit", requestId: "b", messageId: "u2", assistantId: "x2", content: "two" });
    state = reduceAiChat(state, { type: "delta", requestId: "a", content: "OLD" });
    expect(state.messages[state.messages.length - 1]?.content).toBe("");
  });

  test("records errors separately and clear resets everything", () => {
    let state = reduceAiChat(createAiChatState(), { type: "submit", requestId: "a", messageId: "u", assistantId: "x", content: "hello" });
    state = reduceAiChat(state, { type: "error", requestId: "a", error: { kind: "Timeout", message: "secret raw details" } });
    expect(state.status).toBe("error");
    expect(state.error?.kind).toBe("Timeout");
    state = reduceAiChat(state, { type: "clear" });
    expect(state).toEqual(createAiChatState());
  });

  test("retry keeps one user message and replaces the failed assistant", () => {
    let state = reduceAiChat(createAiChatState(), { type: "submit", requestId: "a", messageId: "u", assistantId: "x", content: "hello" });
    state = reduceAiChat(state, { type: "error", requestId: "a", error: { kind: "Timeout", message: "" } });
    state = reduceAiChat(state, { type: "retry", requestId: "b", assistantId: "y" });
    expect(state.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(state.activeRequestId).toBe("b");
  });
});

describe("AI chat input", () => {
  test.each(["", "   ", "\n\t"])("rejects empty input %j", (input) => {
    expect(canSendChat(input, false, true, true)).toBe(false);
  });
  test.each(["hello", "日本語", "line 1\nline 2"])("accepts text %j", (input) => {
    expect(canSendChat(input, false, true, true)).toBe(true);
  });
  test("disables send while running, without Markdown, or without configuration", () => {
    expect(canSendChat("hi", true, true, true)).toBe(false);
    expect(canSendChat("hi", false, false, true)).toBe(false);
    expect(canSendChat("hi", false, true, false)).toBe(false);
  });
  test("Enter sends, while Shift+Enter and IME composition do not", () => {
    expect(shouldSendChatKey("Enter", false, false)).toBe(true);
    expect(shouldSendChatKey("Enter", true, false)).toBe(false);
    expect(shouldSendChatKey("Enter", false, true)).toBe(false);
  });
});
