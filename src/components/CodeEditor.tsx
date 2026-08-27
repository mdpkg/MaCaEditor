import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { markdown } from "@codemirror/lang-markdown";
import { getCM, Vim, vim } from "@replit/codemirror-vim";
import { basicSetup, EditorView } from "codemirror";
import type { AiTaskKind } from "../lib/aiSelection";
import { PACKAGE_PATH_DRAG_TYPE } from "../lib/packageDrag";
import { markdownLinkAtPosition } from "../lib/markdownLinks";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onCursorChange?: (position: number) => void;
  onSelectionChange?: (selection: { from: number; to: number; text: string } | null) => void;
  onSave?: () => void | Promise<void>;
  vimMode?: boolean;
  language?: "markdown" | "plain";
  className?: string;
  ariaLabel?: string;
  onAiSelection?: (task: AiTaskKind) => void;
  onPackagePathDrop?: (path: string, position: number) => void;
  onMarkdownLinkOpen?: (destination: string) => void;
  cursorPosition?: number | null;
}

const vimSaveHandlers = new WeakMap<object, () => void>();
Vim.defineEx("write", "w", (editor) => {
  vimSaveHandlers.get(editor)?.();
});

function preserveScrollPosition(view: EditorView, scrollTop: number, scrollLeft: number) {
  const restore = () => {
    view.scrollDOM.scrollTop = scrollTop;
    view.scrollDOM.scrollLeft = scrollLeft;
  };
  restore();
  requestAnimationFrame(() => {
    restore();
    requestAnimationFrame(restore);
  });
}

export function CodeEditor({
  value,
  onChange,
  onCursorChange,
  onSave,
  vimMode = false,
  language = "plain",
  className = "",
  ariaLabel,
  onSelectionChange,
  onAiSelection,
  onPackagePathDrop,
  onMarkdownLinkOpen,
  cursorPosition = null,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const onCursorChangeRef = useRef(onCursorChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onAiSelectionRef = useRef(onAiSelection);
  const onSaveRef = useRef(onSave);
  const onPackagePathDropRef = useRef(onPackagePathDrop);
  const onMarkdownLinkOpenRef = useRef(onMarkdownLinkOpen);
  const [contextMenu, setContextMenu] = useState<{ from: number; to: number; text: string; hasSelection: boolean; x: number; y: number } | null>(null);
  valueRef.current = value;
  onChangeRef.current = onChange;
  onCursorChangeRef.current = onCursorChange;
  onSelectionChangeRef.current = onSelectionChange;
  onAiSelectionRef.current = onAiSelection;
  onSaveRef.current = onSave;
  onPackagePathDropRef.current = onPackagePathDrop;
  onMarkdownLinkOpenRef.current = onMarkdownLinkOpen;

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
          const sel = update.state.selection.main;
          const text = update.state.doc.sliceString(sel.from, sel.to);
          onSelectionChangeRef.current?.(
            sel.from === sel.to ? null : { from: sel.from, to: sel.to, text },
          );
        }
      }),
      EditorView.domEventHandlers({
        mousedown: (event, view) => {
          if (!(event.ctrlKey || event.metaKey) || !onMarkdownLinkOpenRef.current) return false;
          const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (position === null) return false;
          const link = markdownLinkAtPosition(view.state.doc.toString(), position);
          if (!link) return false;
          event.preventDefault();
          onMarkdownLinkOpenRef.current(link.destination);
          return true;
        },
        dragover: (event) => {
          if (!event.dataTransfer || !Array.from(event.dataTransfer.types).includes(PACKAGE_PATH_DRAG_TYPE)) return false;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          return true;
        },
        drop: (event, view) => {
          const path = event.dataTransfer?.getData(PACKAGE_PATH_DRAG_TYPE) ?? "";
          if (!path || !onPackagePathDropRef.current) return false;
          event.preventDefault();
          const position = view.posAtCoords({ x: event.clientX, y: event.clientY })
            ?? view.state.selection.main.head;
          onPackagePathDropRef.current(path, position);
          return true;
        },
        contextmenu: (event, view) => {
          event.preventDefault?.();
          const sel = view.state.selection.main;
          const text = view.state.doc.sliceString(sel.from, sel.to);
          setContextMenu({
            from: sel.from,
            to: sel.to,
            text,
            hasSelection: sel.from !== sel.to,
            x: event.clientX,
            y: event.clientY,
          });
        },
      }),
      EditorView.theme({
        "&": { height: "100%" },
        ".cm-scroller": { overflow: "auto" },
      }),
    ];
    const view = new EditorView({
      doc: valueRef.current,
      selection: cursorPosition === null ? undefined : { anchor: Math.min(cursorPosition, valueRef.current.length) },
      extensions,
      parent: hostRef.current,
    });
    viewRef.current = view;
    const preserveScrollOnUndo = (event: KeyboardEvent) => {
      const undoOrRedo = (event.ctrlKey || event.metaKey) &&
        (event.key.toLowerCase() === "z" || event.key.toLowerCase() === "y");
      if (!undoOrRedo) return;
      const { scrollTop, scrollLeft } = view.scrollDOM;
      preserveScrollPosition(view, scrollTop, scrollLeft);
    };
    view.dom.addEventListener("keydown", preserveScrollOnUndo, true);
    const vimEditor = vimMode ? getCM(view) : null;
    if (vimEditor) {
      vimSaveHandlers.set(vimEditor, () => { void onSaveRef.current?.(); });
    }
    return () => {
      view.dom.removeEventListener("keydown", preserveScrollOnUndo, true);
      if (vimEditor) vimSaveHandlers.delete(vimEditor);
      view.destroy();
      viewRef.current = null;
    };
  }, [language, vimMode]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    const head = Math.min(view.state.selection.main.head, value.length);
    const { scrollTop, scrollLeft } = view.scrollDOM;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      selection: { anchor: head },
    });
    preserveScrollPosition(view, scrollTop, scrollLeft);
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || cursorPosition === null) return;
    view.dispatch({ selection: { anchor: Math.min(cursorPosition, view.state.doc.length) }, scrollIntoView: true });
    view.focus();
  }, [cursorPosition]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
    };
  }, [contextMenu]);

  const run = (task: AiTaskKind) => {
    setContextMenu(null);
    onAiSelectionRef.current?.(task);
  };

  const closeMenu = () => setContextMenu(null);

  const copy = () => {
    const view = viewRef.current;
    if (!view || !contextMenu) return;
    const text = view.state.doc.sliceString(contextMenu.from, contextMenu.to);
    void navigator.clipboard?.writeText(text);
    closeMenu();
  };

  const cut = () => {
    const view = viewRef.current;
    if (!view || !contextMenu) return;
    const text = view.state.doc.sliceString(contextMenu.from, contextMenu.to);
    void navigator.clipboard?.writeText(text);
    view.dispatch({ changes: { from: contextMenu.from, to: contextMenu.to, insert: "" } });
    closeMenu();
  };

  const paste = () => {
    const view = viewRef.current;
    const menu = contextMenu;
    if (!view || !menu) return;
    void navigator.clipboard?.readText().then((text) => {
      view.dispatch({ changes: { from: menu.from, to: menu.to, insert: text } });
    });
    closeMenu();
  };

  const deleteSelection = () => {
    const view = viewRef.current;
    if (!view || !contextMenu) return;
    view.dispatch({ changes: { from: contextMenu.from, to: contextMenu.to, insert: "" } });
    closeMenu();
  };

  return (
    <>
      <div
        ref={hostRef}
        className={`code-editor ${className}`.trim()}
      />
      {contextMenu && createPortal(
        <div
          className="editor-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button type="button" onClick={copy}>コピー</button>
          <button type="button" onClick={cut}>切り取り</button>
          <button type="button" onClick={paste}>貼り付け</button>
          <button type="button" onClick={deleteSelection}>削除</button>
          <div className="editor-context-menu-divider" />
          <div className="editor-context-menu-submenu">
            <span className="editor-context-menu-submenu-label">AI</span>
            <div className="editor-context-menu-submenu-items">
              <button type="button" onClick={() => run("Rewrite")}>Rewrite</button>
              <button type="button" onClick={() => run("Summarize")}>Summarize</button>
              <button type="button" onClick={() => run("Proofread")}>Proofread</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
