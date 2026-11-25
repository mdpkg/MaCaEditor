import { act } from "react";
import { createRoot } from "react-dom/client";
import { EditorView } from "codemirror";
import { expect, test, vi } from "vitest";
import { CodeEditor } from "./CodeEditor";
import { ChachaSession } from "../lib/chachaSession";
import { normalizeChachaSettings } from "../lib/chachaSettings";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
test("CodeEditorに統合してもコメント操作はonChangeや選択・履歴を変更しない", async () => {
  vi.useFakeTimers(); vi.setSystemTime(0); vi.spyOn(document, "hasFocus").mockReturnValue(true);
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => new DOMRect() });
  const transport = vi.fn(async () => '{"type":"reaction","comment":"読んだよ"}');
  const session = new ChachaSession(normalizeChachaSettings(), transport);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); const change = vi.fn();
  try {
    await act(async () => root.render(<CodeEditor language="markdown" value="対象" onChange={change} chachaSession={session} chachaFileId="a.md" />));
    const view = EditorView.findFromDOM(host.querySelector<HTMLElement>(".cm-editor")!)!;
    Object.defineProperty(view.scrollDOM, "clientHeight", { configurable: true, value: 600 });
    await act(async () => { view.focus(); session.enable(); view.dispatch({ changes: { from: 2, insert: "あ".repeat(100) }, userEvent: "input.type" }); await vi.advanceTimersByTimeAsync(5000); });
    expect(transport).toHaveBeenCalledOnce(); expect(change).toHaveBeenCalledOnce();
    const selection = view.state.selection.toJSON(), text = view.state.doc.toString();
    await act(async () => {
      host.querySelector<HTMLButtonElement>('.cm-chacha-gutter [aria-label="茶々入れコメントを削除"]')!.click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(change).toHaveBeenCalledOnce(); expect(view.state.selection.toJSON()).toEqual(selection); expect(view.state.doc.toString()).toBe(text);
    await act(async () => root.render(<CodeEditor language="markdown" value="外部同期" onChange={change} chachaSession={session} chachaFileId="a.md" />));
    await act(async () => { await vi.advanceTimersByTimeAsync(120000); }); expect(transport).toHaveBeenCalledOnce();
  } finally {
    act(() => root.unmount()); session.dispose(); host.remove(); vi.restoreAllMocks(); vi.useRealTimers();
    Reflect.deleteProperty(Range.prototype, "getClientRects"); Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
  }
});
