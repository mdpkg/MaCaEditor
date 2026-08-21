import { useEffect, useRef } from "react";
import { markdown } from "@codemirror/lang-markdown";
import { getCM, Vim, vim } from "@replit/codemirror-vim";
import { basicSetup, EditorView } from "codemirror";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onCursorChange?: (position: number) => void;
  onSave?: () => void | Promise<void>;
  vimMode?: boolean;
  language?: "markdown" | "plain";
  className?: string;
  ariaLabel?: string;
}

const vimSaveHandlers = new WeakMap<object, () => void>();
Vim.defineEx("write", "w", (editor) => {
  vimSaveHandlers.get(editor)?.();
});

export function CodeEditor({
  value,
  onChange,
  onCursorChange,
  onSave,
  vimMode = false,
  language = "plain",
  className = "",
  ariaLabel,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const onCursorChangeRef = useRef(onCursorChange);
  const onSaveRef = useRef(onSave);
  valueRef.current = value;
  onChangeRef.current = onChange;
  onCursorChangeRef.current = onCursorChange;
  onSaveRef.current = onSave;

  useEffect(() => {
    if (!hostRef.current) return;
    const extensions = [
      ...(vimMode ? [vim({ status: true })] : []),
      basicSetup,
      ...(language === "markdown" ? [markdown()] : []),
      EditorView.lineWrapping,
      ...(ariaLabel ? [EditorView.contentAttributes.of({ "aria-label": ariaLabel })] : []),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChangeRef.current(update.state.doc.toString());
        if (update.docChanged || update.selectionSet) {
          onCursorChangeRef.current?.(update.state.selection.main.head);
        }
      }),
      EditorView.theme({
        "&": { height: "100%" },
        ".cm-scroller": { overflow: "auto" },
      }),
    ];
    const view = new EditorView({
      doc: valueRef.current,
      extensions,
      parent: hostRef.current,
    });
    viewRef.current = view;
    const vimEditor = vimMode ? getCM(view) : null;
    if (vimEditor) {
      vimSaveHandlers.set(vimEditor, () => { void onSaveRef.current?.(); });
    }
    return () => {
      if (vimEditor) vimSaveHandlers.delete(vimEditor);
      view.destroy();
      viewRef.current = null;
    };
  }, [language, vimMode]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    const head = Math.min(view.state.selection.main.head, value.length);
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      selection: { anchor: head },
    });
  }, [value]);

  return <div
    ref={hostRef}
    className={`code-editor ${className}`.trim()}
  />;
}
