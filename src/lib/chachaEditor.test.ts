import { EditorView, basicSetup } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { openSearchPanel, searchPanelOpen } from "@codemirror/search";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { createChachaExtension, continueChachaComment, dismissChachaComment } from "./chachaEditor";
import { ChachaSession } from "./chachaSession";
import { normalizeChachaSettings } from "./chachaSettings";

const cleanup: Array<() => void> = [];
beforeAll(() => {
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => new DOMRect() });
});
afterAll(() => { Reflect.deleteProperty(Range.prototype, "getClientRects"); Reflect.deleteProperty(Range.prototype, "getBoundingClientRect"); });
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); vi.spyOn(document, "hasFocus").mockReturnValue(true); });
afterEach(() => { cleanup.splice(0).reverse().forEach((f) => f()); vi.restoreAllMocks(); vi.useRealTimers(); document.body.innerHTML = ""; });
function setup(source = "対象") {
  const transport = vi.fn(async () => '{"type":"reaction","comment":"<img src=https://example.invalid>読者の声"}');
  const handoff = vi.fn(() => true);
  const session = new ChachaSession(normalizeChachaSettings(), transport, { capture: () => ({ documentScopeKey: "doc", connection: { endpoint: "https://reader.test", model: "reader", revision: "one" } }), onContinue: handoff });
  const host = document.createElement("div"); document.body.append(host);
  const view = new EditorView({ parent: host, doc: source, extensions: [basicSetup, markdown(), createChachaExtension(session)] });
  Object.defineProperty(view.scrollDOM, "clientHeight", { configurable: true, value: 600 });
  view.focus(); session.enable();
  cleanup.push(() => { view.destroy(); session.dispose(); host.remove(); });
  const write = () => view.dispatch({ changes: { from: view.state.doc.length, insert: "あ".repeat(100) }, userEvent: "input.type" });
  return { view, session, transport, write, handoff };
}
test.each(["input.type", "delete.backward", "input.paste", "undo", "redo"])("a small %s document change is eligible without a count threshold", async (userEvent) => {
  const h = setup("対象段落");
  h.view.dispatch({ changes: userEvent.startsWith("delete") ? { from: 1, to: 2 } : { from: 2, to: 3, insert: "改" }, userEvent });
  await vi.advanceTimersByTimeAsync(4999); expect(h.transport).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); expect(h.transport).toHaveBeenCalledOnce();
});
test("deleting the last character of a paragraph still marks that paragraph as edited", async () => {
  const h = setup("対象一");
  h.view.dispatch({ changes: { from: 2, to: 3 }, userEvent: "delete.backward" });
  await vi.advanceTimersByTimeAsync(5000); expect(h.transport).toHaveBeenCalledOnce();
});
test("吹き出しはボタンだけ、明示操作で引用会話を開き本文・選択を変更しない", async () => {
  const h = setup(); h.write();
  const text = h.view.state.doc.toString(), selection = h.view.state.selection.toJSON(), focus = document.activeElement;
  await vi.advanceTimersByTimeAsync(5000);
  expect(h.transport).toHaveBeenCalledOnce();
  expect(h.view.dom.querySelector('.cm-chacha-gutter [aria-label="茶々入れから会話を開く"]')).not.toBeNull();
  expect(h.view.dom.querySelector('.cm-chacha-gutter [aria-label="茶々入れから会話を開く"]')!.closest('[aria-hidden="true"]')).toBeNull();
  expect(h.view.dom.querySelector(".cm-chacha-tooltip")).toBeNull();
  expect(continueChachaComment(h.view)).toBe(true); await vi.advanceTimersByTimeAsync(30);
  expect(h.view.dom.querySelector(".cm-chacha-tooltip")).toBeNull();
  expect(h.handoff).toHaveBeenCalledWith(expect.objectContaining({ reaction: "<img src=https://example.invalid>読者の声" }));
  expect(h.view.dom.querySelector(".cm-chacha-tooltip img")).toBeNull();
  expect(dismissChachaComment(h.view)).toBe(false); await vi.advanceTimersByTimeAsync(0);
  expect(h.view.state.doc.toString()).toBe(text); expect(h.view.state.selection.toJSON()).toEqual(selection);
  expect(document.activeElement).toBe(focus); expect(h.view.scrollDOM.scrollTop).toBe(0);
});
test("通常のEscは削除し、IME・検索・他ツールチップのEscは優先する", async () => {
  const h = setup(); h.write(); await vi.advanceTimersByTimeAsync(5000);
  h.view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true, cancelable: true, isComposing: true }));
  expect(h.session.snapshot.phase).toBe("collapsed");
  openSearchPanel(h.view);
  h.view.dom.querySelector(".cm-search input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true, cancelable: true }));
  expect(searchPanelOpen(h.view.state)).toBe(false); expect(h.session.snapshot.phase).toBe("collapsed");
  const tooltip = document.createElement("div"); tooltip.className = "cm-tooltip cm-tooltip-autocomplete"; h.view.dom.append(tooltip);
  h.view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true, cancelable: true }));
  expect(h.session.snapshot.phase).toBe("collapsed"); tooltip.remove();
  h.view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true, cancelable: true }));
  expect(h.session.snapshot.phase).toBe("idle");
});
test("画面外へ移動したコメントを削除し、エディタ破棄後の通信を止める", async () => {
  const h = setup(); h.write(); await vi.advanceTimersByTimeAsync(5000);
  h.view.scrollDOM.scrollTop = 1000; h.view.scrollDOM.dispatchEvent(new Event("scroll"));
  expect(h.session.snapshot.comment).toBeUndefined();
});
test("段落全体の削除で、後続の未編集段落を送信しない", async () => {
  const h = setup("対".repeat(100) + "\n\n未編集");
  h.view.dispatch({ changes: { from: 0, to: 102 }, userEvent: "delete" });
  await vi.advanceTimersByTimeAsync(5000);
  expect(h.view.state.doc.toString()).toBe("未編集"); expect(h.transport).not.toHaveBeenCalled();
});
test("専用キーはIME入力を優先し、引用会話をキーボードだけで開ける", async () => {
  const h = setup(); h.write(); await vi.advanceTimersByTimeAsync(5000);
  h.view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, ctrlKey: true, altKey: true, isComposing: true, bubbles: true, cancelable: true }));
  expect(h.session.snapshot.phase).toBe("collapsed");
  h.view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, ctrlKey: true, altKey: true, bubbles: true, cancelable: true }));
  await vi.advanceTimersByTimeAsync(30); expect(h.session.snapshot.phase).toBe("idle"); expect(h.handoff).toHaveBeenCalledOnce();
  h.view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", code: "Backspace", keyCode: 8, ctrlKey: true, altKey: true, bubbles: true, cancelable: true }));
  expect(h.session.snapshot.phase).toBe("idle");
});
test("IME未確定では送信せず、確定した短い本文変更を候補にする", async () => {
  const h = setup();
  h.view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
  h.view.dispatch({ changes: { from: 2, insert: "a".repeat(200) }, userEvent: "input.type.compose" });
  await vi.advanceTimersByTimeAsync(10000); expect(h.transport).not.toHaveBeenCalled();
  h.view.dispatch({ changes: { from: 2, to: 202, insert: "日".repeat(50) }, userEvent: "input.type.compose" });
  h.view.contentDOM.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  await vi.advanceTimersByTimeAsync(5000); expect(h.transport).toHaveBeenCalledOnce();
  h.write(); await vi.advanceTimersByTimeAsync(30000); expect(h.transport).toHaveBeenCalledTimes(2);
});
