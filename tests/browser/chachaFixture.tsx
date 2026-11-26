import { createRoot, type Root } from "react-dom/client";
import { useState } from "react";
import { EditorView } from "codemirror";
import { StateEffect } from "@codemirror/state";
import { autocompletion, startCompletion } from "@codemirror/autocomplete";
import { CodeEditor } from "../../src/components/CodeEditor";
import { ChachaSession } from "../../src/lib/chachaSession";
import { normalizeChachaSettings } from "../../src/lib/chachaSettings";
import { AiChatPanel } from "../../src/components/AiChatPanel";
import { ChatSessionsController } from "../../src/lib/chatSessionsController";

let root: Root | undefined, session: ChachaSession, calls = 0, changes = 0;
const source = "# 章\n\n前の段落\n\n対象\n\n後の段落\n\n" + "遠い段落\n\n".repeat(50);
const view = () => EditorView.findFromDOM(document.querySelector<HTMLElement>(".cm-editor")!)!;
export function mount(options: { vim?: boolean; enabled?: boolean } = {}) {
  root?.unmount(); session?.dispose(); calls = 0; changes = 0;
  const connection = { endpoint: "https://reader.test", model: "reader", revision: "one" };
  const controller = new ChatSessionsController("doc", { connection: async () => connection, document: () => "", send: async (request) => ({ request_id: request.requestId, content: "" }), cancel: async () => true });
  void controller.refreshConnection();
  let show = () => {};
  session = new ChachaSession(normalizeChachaSettings(), async () => { calls++; return '{"type":"reaction","comment":"<img src=https://invalid.test>読者の声"}'; }, {
    capture: () => ({ documentScopeKey: "doc", connection }), onContinue: (quote) => { if (!controller.addQuote(quote)) return false; show(); return true; },
  });
  function Editor() {
    const [text, setText] = useState(source);
    const [open, setOpen] = useState(false); show = () => setOpen(true);
    return <div className="main-layout" style={{ height: "100%" }}><CodeEditor className="markdown-editor" language="markdown" value={text} onChange={(value) => { changes++; setText(value); }} vimMode={options.vim}
      chachaSession={session} chachaFileId="a.md" />{open && <AiChatPanel controller={controller} onOpenAiSettings={() => {}}
        onClose={() => { setOpen(false); view().contentDOM.focus(); }} />}</div>;
  }
  root = createRoot(document.getElementById("app")!); root.render(<Editor />);
  if (options.enabled !== false) session.enable();
}
export function write(text = "あ".repeat(100)) {
  const editor = view(), from = editor.state.doc.toString().indexOf("対象") + 2;
  editor.focus(); editor.dispatch({ changes: { from, insert: text }, selection: { anchor: from + text.length }, userEvent: "input.type" });
}
export function inspect() {
  const editor = view(); return { text: editor.state.doc.toString(), selection: editor.state.selection.toJSON(), scroll: editor.scrollDOM.scrollTop,
    focus: document.activeElement === editor.contentDOM, windowFocus: document.hasFocus(), visibility: document.visibilityState,
    enabled: session.snapshot.enabled, paused: session.snapshot.paused, reason: session.snapshot.reason,
    phase: session.snapshot.phase, calls, changes };
}
export function scrollAway() { view().scrollDOM.scrollTop = view().scrollDOM.scrollHeight; view().scrollDOM.dispatchEvent(new Event("scroll")); }
export function complete() {
  const editor = view(); editor.dispatch({ effects: StateEffect.appendConfig.of(autocompletion({ override: [() => ({ from: editor.state.selection.main.head, options: [{ label: "suggestion" }] })] })) });
  startCompletion(editor);
}
