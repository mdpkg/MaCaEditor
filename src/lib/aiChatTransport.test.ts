import { expect, test } from "vitest";
import { chatHistory, createAiChatState, reduceAiChat } from "./aiChat";

test.each(["cancelled", "failed", "streaming"] as const)("excludes the whole %s turn", (status) => {
  expect(chatHistory([
    { id: "u", role: "user", content: "failed question" },
    { id: "a", role: "assistant", content: "partial", status },
    { id: "u2", role: "user", content: "good question" },
    { id: "a2", role: "assistant", content: "answer", status: "complete" },
  ])).toEqual([{ role: "User", content: "good question" }, { role: "Assistant", content: "answer" }]);
});
test("authoritative command completion replaces partial deltas and ignores late delivery", () => {
  let state = reduceAiChat(createAiChatState(), { type: "submit", requestId: "r", messageId: "u", assistantId: "a", content: "q" });
  state = reduceAiChat(state, { type: "delta", requestId: "r", content: "part" });
  state = reduceAiChat(state, { type: "completed", requestId: "r", content: "full answer" });
  state = reduceAiChat(state, { type: "delta", requestId: "r", content: "late" });
  expect(state.messages[1].content).toBe("full answer");
});

test("retry preserves earlier failed turns in the UI", () => {
  let state = createAiChatState();
  for (const requestId of ["first", "second"]) {
    state = reduceAiChat(state, { type: "submit", requestId, messageId: requestId + "u", assistantId: requestId + "a", content: requestId });
    state = reduceAiChat(state, { type: "error", requestId, error: { kind: "Timeout", message: "" } });
  }
  state = reduceAiChat(state, { type: "retry", requestId: "retry", assistantId: "retry-a" });
  expect(state.messages.map((message) => message.id)).toEqual(["firstu", "firsta", "secondu", "retry-a"]);
});
