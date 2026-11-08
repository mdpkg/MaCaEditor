import { uiText } from "../lib/uiText";
import { localizeVimPanel } from "../lib/vimLocalization";
import { Menu, MenuSubmenu } from "./Menu";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { markdown } from "@codemirror/lang-markdown";
import { getCM, Vim, vim } from "@replit/codemirror-vim";
import { basicSetup, EditorView } from "codemirror";
import { openSearchPanel } from "@codemirror/search";
import { Annotation, Compartment, EditorState, Prec, StateEffect, StateField } from "@codemirror/state";
import { Decoration, highlightSpecialChars } from "@codemirror/view";
import type { AiTaskKind } from "../lib/aiSelection";
import { PACKAGE_PATH_DRAG_TYPE, PACKAGE_PATH_POINTER_DROP, type PackagePathPointerDrop } from "../lib/packageDrag";
import { isDocumentSearchShortcut } from "../lib/shortcuts";
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
  initialCursorPosition?: number;
  initialScrollTop?: number;
  onScrollTopChange?: (position: number) => void;
  navigation?: { offset: number; length?: number };
  onNavigationComplete?: () => void;
  diagnosticRanges?: Array<{ from: number; to: number }>;
}

const noDiagnosticRanges: NonNullable<Props["diagnosticRanges"]> = [];
const specialCharacterNames: Partial<Record<number, string>> = {
  0x0000: "ヌル文字",
  0x0007: "ベル",
  0x0008: "後退",
  0x000A: "改行",
  0x000B: "垂直タブ",
  0x000D: "復帰",
  0x001B: "エスケープ",
  0x200B: "ゼロ幅スペース",
  0x200C: "ゼロ幅非接合子",
  0x200D: "ゼロ幅接合子",
  0x200E: "左から右へのマーク",
  0x200F: "右から左へのマーク",
  0x2028: "行区切り",
  0x2029: "段落区切り",
  0x202D: "左から右への上書き",
  0x202E: "右から左への上書き",
  0x2066: "左から右への分離開始",
  0x2067: "右から左への分離開始",
  0x2069: "方向分離の終了",
  0xFEFF: "ゼロ幅改行なしスペース",
  0xFFFC: "オブジェクト置換文字",
};
const localizedSpecialCharacters = highlightSpecialChars({
  render: (code, _description, placeholder) => {
    const name = specialCharacterNames[code];
    const codePoint = "U+" + code.toString(16).toUpperCase().padStart(4, "0");
    const label = name ? `制御文字 ${name}（${codePoint}）` : `制御文字 ${codePoint}`;
    const marker = document.createElement("span");
    marker.className = "cm-specialChar";
    marker.textContent = placeholder;
    marker.title = label;
    marker.setAttribute("aria-label", label);
    return marker;
  },
});
const controlledChange = Annotation.define<boolean>();
const setNavigationHighlight = StateEffect.define<{ from: number; to: number } | null>();
const navigationHighlight = StateField.define({
  create: () => Decoration.none,
  update(value, transaction) {
    let next = value.map(transaction.changes);
    for (const effect of transaction.effects) if (effect.is(setNavigationHighlight)) {
      next = effect.value ? Decoration.set([Decoration.mark({ class: "cm-navigation-highlight" }).range(effect.value.from, effect.value.to)]) : Decoration.none;
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});
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
  initialCursorPosition = 0,
  initialScrollTop,
  onScrollTopChange,
  navigation,
  onNavigationComplete,
  diagnosticRanges = noDiagnosticRanges,
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
  const [contextMenu, setContextMenu] = useState<{ from: number; to: number; x: number; y: number } | null>(null);
  const vimCompartmentRef = useRef(new Compartment());
  const scrollFrameRef = useRef<number | null>(null);
  const onScrollTopChangeRef = useRef(onScrollTopChange);
  const onNavigationCompleteRef = useRef(onNavigationComplete);
  onScrollTopChangeRef.current = onScrollTopChange;
  onNavigationCompleteRef.current = onNavigationComplete;
  const diagnosticsCompartmentRef = useRef(new Compartment());
  const highlightTimer = useRef<number | null>(null);
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
    const openMenu = (view: EditorView, x: number, y: number) => {
      const { from, to } = view.state.selection.main;
      view.focus();
      setContextMenu({ from, to, x, y });
    };
    const insertPackagePath = (view: EditorView, path: string, x: number, y: number) => {
      const position = view.posAtCoords({ x, y }) ?? view.state.selection.main.head;
      onPackagePathDropRef.current?.(path, position);
    };
    const extensions = [
      Prec.highest(EditorView.domEventHandlers({
        keydown: (event, view) => {
          if (event.isComposing) return false;
          if (isDocumentSearchShortcut(event)) return openSearchPanel(view);
          if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return false;
          const anchor = view.coordsAtPos(view.state.selection.main.head) ?? view.contentDOM.getBoundingClientRect();
          openMenu(view, anchor.left, anchor.bottom);
          return true;
        },
      })),
      vimCompartmentRef.current.of([]),
      basicSetup,
      localizedSpecialCharacters,
      EditorState.phrases.of({
        Completions: "補完候補", Diagnostics: "エディタの診断", "No diagnostics": "診断結果はありません。",
        Find: "検索", Replace: "置換", next: "次へ", previous: "前へ", all: "すべて",
        "match case": "大文字と小文字を区別", regexp: "正規表現", "by word": "単語単位",
        replace: "置換", "replace all": "すべて置換", close: "閉じる",
        "current match": "現在の一致", "replaced $ matches": "$ 件を置換しました",
        "replaced match on line $": "$ 行目の一致を置換しました",
        "on line": "行", "Go to line": "指定行へ移動", go: "移動",
        "Selection deleted": "選択範囲を削除しました",
        "Fold line": "行を折りたたむ", "Unfold line": "行を展開する",
        "folded code": "折りたたまれた範囲", unfold: "展開する",
        "Folded lines": "折りたたんだ行", "Unfolded lines": "展開した行", to: "〜",
      }),
      ...(language === "markdown" ? [markdown()] : []),
      EditorView.lineWrapping,
      diagnosticsCompartmentRef.current.of([]),
      navigationHighlight,
      ...(ariaLabel ? [EditorView.contentAttributes.of({ "aria-label": uiText(ariaLabel) })] : []),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && update.transactions.some((tr) => tr.docChanged && !tr.annotation(controlledChange))) {
          onChangeRef.current(update.state.doc.toString());
        }
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
          insertPackagePath(view, path, event.clientX, event.clientY);
          return true;
        },
        contextmenu: (event, view) => {
          openMenu(view, event.clientX, event.clientY);
          return true;
        },
      }),
      EditorView.theme({
        "&": { height: "100%" },
        ".cm-scroller": { overflow: "auto" },
      }),
    ];
    const view = new EditorView({
      doc: valueRef.current,
      selection: { anchor: Math.min(initialCursorPosition, valueRef.current.length) },
      extensions,
      parent: hostRef.current,
    });
    viewRef.current = view;
    const onPointerDrop = (event: Event) => {
      if (!onPackagePathDropRef.current || !view.contentDOM.contains(event.target as Node)) return;
      const { path, x, y } = (event as CustomEvent<PackagePathPointerDrop>).detail;
      insertPackagePath(view, path, x, y);
    };
    view.dom.addEventListener(PACKAGE_PATH_POINTER_DROP, onPointerDrop);
    const preserveScrollOnUndo = (event: KeyboardEvent) => {
      const undoOrRedo = (event.ctrlKey || event.metaKey) &&
        (event.key.toLowerCase() === "z" || event.key.toLowerCase() === "y");
      if (!undoOrRedo) return;
      const { scrollTop, scrollLeft } = view.scrollDOM;
      preserveScrollPosition(view, scrollTop, scrollLeft);
    };
    view.dom.addEventListener("keydown", preserveScrollOnUndo, true);
    const recordScroll = () => onScrollTopChangeRef.current?.(view.scrollDOM.scrollTop);
    view.scrollDOM.addEventListener("scroll", recordScroll, { passive: true });
    if (initialScrollTop !== undefined && !navigation) {
      scrollFrameRef.current = requestAnimationFrame(() => {
        scrollFrameRef.current = null;
        view.scrollDOM.scrollTop = initialScrollTop;
        view.scrollDOM.dispatchEvent(new Event("scroll"));
      });
    }
    return () => {
      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
      view.scrollDOM.removeEventListener("scroll", recordScroll);
      view.dom.removeEventListener("keydown", preserveScrollOnUndo, true);
      view.dom.removeEventListener(PACKAGE_PATH_POINTER_DROP, onPointerDrop);
      if (highlightTimer.current !== null) window.clearTimeout(highlightTimer.current);
      view.destroy();
      viewRef.current = null;
    };
  }, [language]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: vimCompartmentRef.current.reconfigure(vimMode ? vim({ status: true }) : []) });
    const vimEditor = getCM(view);
    if (!vimEditor) return;
    vimSaveHandlers.set(vimEditor, () => { void onSaveRef.current?.(); });
    const panel = view.dom.querySelector<HTMLElement>(".cm-vim-panel");
    const disposeLocalization = panel && localizeVimPanel(panel, vimEditor);
    return () => {
      disposeLocalization?.();
      vimSaveHandlers.delete(vimEditor);
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
      annotations: controlledChange.of(true),
    });
    preserveScrollPosition(view, scrollTop, scrollLeft);
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !navigation) return;
    if (scrollFrameRef.current !== null) {
      cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = null;
    }
    const from = Math.max(0, Math.min(navigation.offset, view.state.doc.length));
    const to = Math.min(view.state.doc.length, from + Math.max(1, navigation.length ?? 1));
    if (highlightTimer.current !== null) window.clearTimeout(highlightTimer.current);
    view.dispatch({ selection: { anchor: from }, scrollIntoView: true,
      effects: setNavigationHighlight.of(from < to ? { from, to } : null) });
    highlightTimer.current = window.setTimeout(() => {
      if (viewRef.current === view) view.dispatch({ effects: setNavigationHighlight.of(null) });
      highlightTimer.current = null;
    }, 2000);
    view.focus();
    onNavigationCompleteRef.current?.();
  }, [language, navigation]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const ranges = diagnosticRanges
      .filter((range) => range.from < range.to && range.from < view.state.doc.length)
      .map((range) => Decoration.mark({ class: "cm-broken-package-link" })
        .range(Math.max(0, range.from), Math.min(view.state.doc.length, range.to)));
    view.dispatch({ effects: diagnosticsCompartmentRef.current.reconfigure(
      EditorView.decorations.of(Decoration.set(ranges)),
    ) });
  }, [language, diagnosticRanges]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = (event: Event) => {
      if (event.target instanceof Element && event.target.closest(".editor-context-menu")) return;
      setContextMenu(null);
    };
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
        <Menu className="editor-context-menu" label={uiText("Editor actions")} position={contextMenu} onClose={closeMenu}>
          <button type="button" role="menuitem" onClick={copy}>{uiText("Copy")}</button>
          <button type="button" role="menuitem" onClick={cut}>{uiText("Cut")}</button>
          <button type="button" role="menuitem" onClick={paste}>{uiText("Paste")}</button>
          <button type="button" role="menuitem" onClick={deleteSelection}>{uiText("Delete")}</button>
          <div className="editor-context-menu-divider" role="separator" />
          <MenuSubmenu title="AI">
            <button type="button" role="menuitem" onClick={() => run("Rewrite")}>{uiText("Rewrite")}</button>
            <button type="button" role="menuitem" onClick={() => run("Summarize")}>{uiText("Summarize")}</button>
            <button type="button" role="menuitem" onClick={() => run("Proofread")}>{uiText("Proofread")}</button>
          </MenuSubmenu>
        </Menu>,
        hostRef.current?.closest('[role="dialog"]') ?? document.body,
      )}
    </>
  );
}
