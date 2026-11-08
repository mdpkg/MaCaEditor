import { isPackageSearchShortcut } from "../lib/shortcuts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { CodeEditor } from "./CodeEditor";
import { EditorView } from "codemirror";
import { getCM, Vim, type CodeMirrorV } from "@replit/codemirror-vim";
import { PACKAGE_PATH_DRAG_TYPE } from "../lib/packageDrag";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("CodeEditor", () => {
  test("routes document history through the host in standard and Vim modes", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const onHistory = vi.fn();
    const onChange = vi.fn();
    const render = (vimMode: boolean) => act(() => root.render(<CodeEditor
      value="Original" onChange={onChange} onHistory={onHistory} vimMode={vimMode} />));
    try {
      render(false);
      const view = EditorView.findFromDOM(host.querySelector<HTMLElement>(".cm-editor")!)!;
      act(() => view.dispatch({ changes: { from: 8, insert: "!" } }));
      act(() => view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", {
        key: "z", ctrlKey: true, bubbles: true, cancelable: true,
      })));
      expect(onHistory).toHaveBeenLastCalledWith("undo");
      expect(view.state.doc.toString()).toBe("Original!");

      render(true);
      const vim = getCM(view) as CodeMirrorV;
      act(() => Vim.handleKey(vim, "u", "user"));
      act(() => Vim.handleKey(vim, "<C-r>", "user"));
      act(() => Vim.handleEx(vim, "undo"));
      act(() => view.contentDOM.dispatchEvent(new InputEvent("beforeinput", {
        inputType: "historyRedo", bubbles: true, cancelable: true,
      })));
      expect(onHistory.mock.calls).toEqual([["undo"], ["undo"], ["redo"], ["undo"], ["redo"]]);
    } finally {
      act(() => root.unmount());
    }
  });

  test("reports a composition only after its final change", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const onChange = vi.fn();
    const onHistory = vi.fn();
    act(() => root.render(<CodeEditor value="" onChange={onChange} onHistory={onHistory} />));
    try {
      const view = EditorView.findFromDOM(host.querySelector<HTMLElement>(".cm-editor")!)!;
      const composing = vi.spyOn(view, "composing", "get").mockReturnValue(true);
      const compositionEvent = (name: string) => view.contentDOM.dispatchEvent(new CompositionEvent(name, { bubbles: true }));
      act(() => {
        compositionEvent("compositionstart");
        view.dispatch({ changes: { from: 0, insert: "か" }, userEvent: "input.type.compose" });
        view.dispatch({ changes: { from: 0, to: 1, insert: "漢" }, userEvent: "input.type.compose" });
      });
      expect(onChange).not.toHaveBeenCalled();
      await act(async () => {
        composing.mockReturnValue(false);
        compositionEvent("compositionend");
      });
      expect(onChange.mock.calls).toEqual([["漢"]]);
    } finally {
      act(() => root.unmount());
    }
  });

  test("localizes diagnostic and control character labels", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<CodeEditor value={"A\u200bB\u001fC"} onChange={vi.fn()} language="markdown" />));
    const markers = [...container.querySelectorAll<HTMLElement>(".cm-specialChar")];
    const labels = ["制御文字 ゼロ幅スペース（U+200B）", "制御文字 U+001F"];
    expect(markers.map((marker) => marker.title)).toEqual(labels);
    expect(markers.map((marker) => marker.getAttribute("aria-label"))).toEqual(labels);

    const mac = /Mac/.test(navigator.platform);
    act(() => container.querySelector(".cm-content")!.dispatchEvent(new KeyboardEvent("keydown", {
      key: "M", code: "KeyM", keyCode: 77, ctrlKey: !mac, metaKey: mac, shiftKey: true, bubbles: true, cancelable: true,
    })));
    const diagnostics = container.querySelector(".cm-panel-lint [role=listbox]");
    expect(diagnostics?.getAttribute("aria-label")).toBe("エディタの診断");
    expect(diagnostics?.textContent).toBe("診断結果はありません。");
    act(() => root.unmount());
  });

  test("highlights a navigation match temporarily and maps it safely through edits", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const host = document.createElement("div"); document.body.appendChild(host); const root = createRoot(host);
    act(() => root.render(<CodeEditor value="Before needle after" onChange={vi.fn()} navigation={{ offset: 7, length: 6 }} />));
    expect(host.querySelector(".cm-navigation-highlight")?.textContent).toBe("needle");
    act(() => vi.advanceTimersByTime(2000));
    expect(host.querySelector(".cm-navigation-highlight")).toBeNull();
    act(() => root.render(<CodeEditor value="Before needle after" onChange={vi.fn()} navigation={{ offset: 7, length: 6 }} />));
    act(() => root.render(<CodeEditor value="" onChange={vi.fn()} />));
    expect(host.querySelector(".cm-content")?.textContent?.trim()).toBe("");
    act(() => root.unmount()); host.remove(); vi.useRealTimers();
  });
  test("preserves the editor scroll position across undo", () => {
    const restoreFrames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      restoreFrames.push(callback); return restoreFrames.length;
    });
    const container = document.createElement("div"); document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<CodeEditor value={"line\n".repeat(100)} onChange={vi.fn()} />));
    const editorElement = container.querySelector(".cm-editor") as HTMLElement;
    const scroller = editorElement.querySelector(".cm-scroller") as HTMLElement;
    scroller.scrollTop = 240;
    act(() => editorElement.querySelector(".cm-content")!.dispatchEvent(new KeyboardEvent("keydown", {
      key: "z", ctrlKey: true, bubbles: true, cancelable: true,
    })));
    scroller.scrollTop = 0;
    act(() => {
      while (restoreFrames.length > 0) restoreFrames.shift()?.(0);
    });
    expect(scroller.scrollTop).toBe(240);
    act(() => root.unmount());
    vi.unstubAllGlobals();
  });

  test("reports a package file dropped at the editor position", () => {
    const onPackagePathDrop = vi.fn();
    const container = document.createElement("div"); document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<CodeEditor value="hello" onChange={vi.fn()}
      onPackagePathDrop={onPackagePathDrop} />));
    const editorElement = container.querySelector(".cm-editor") as HTMLElement;
    const view = EditorView.findFromDOM(editorElement)!;
    vi.spyOn(view, "posAtCoords").mockReturnValue(2);
    const dataTransfer = {
      files: [], types: [PACKAGE_PATH_DRAG_TYPE], dropEffect: "none", effectAllowed: "copyMove",
      setData: vi.fn(), getData: (type: string) => type === PACKAGE_PATH_DRAG_TYPE ? "docs/guide.md" : "",
    };
    const content = editorElement.querySelector(".cm-content")!;
    const dragOver = new MouseEvent("dragover", { bubbles: true, cancelable: true, clientX: 10, clientY: 20 });
    Object.defineProperty(dragOver, "dataTransfer", { value: dataTransfer });
    act(() => content.dispatchEvent(dragOver));
    const drop = new MouseEvent("drop", { bubbles: true, cancelable: true, clientX: 10, clientY: 20 });
    Object.defineProperty(drop, "dataTransfer", { value: dataTransfer });
    act(() => content.dispatchEvent(drop));
    expect(onPackagePathDrop).toHaveBeenCalledWith("docs/guide.md", 2);
    expect(dataTransfer.dropEffect).toBe("copy");
    act(() => root.unmount());
  });

  test("opens a Markdown link under Ctrl-click", () => {
    const onMarkdownLinkOpen = vi.fn();
    const container = document.createElement("div"); document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<CodeEditor value="[Guide](docs/guide.md)" onChange={vi.fn()}
      onMarkdownLinkOpen={onMarkdownLinkOpen} />));
    const editorElement = container.querySelector(".cm-editor") as HTMLElement;
    const view = EditorView.findFromDOM(editorElement)!;
    vi.spyOn(view, "posAtCoords").mockReturnValue(10);
    act(() => editorElement.querySelector(".cm-content")!.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true, cancelable: true, ctrlKey: true, clientX: 10, clientY: 20,
    })));
    expect(onMarkdownLinkOpen).toHaveBeenCalledWith("docs/guide.md");
    act(() => root.unmount());
  });

  test("uses standard mode by default and can enable Vim mode", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onChange = vi.fn();

    act(() => root.render(<CodeEditor value="alpha" onChange={onChange} language="markdown" />));
    expect(container.querySelector(".cm-editor")?.textContent).toContain("alpha");
    expect(container.querySelector(".cm-vim-panel")).toBeNull();

    act(() => root.render(<CodeEditor value="alpha" onChange={onChange} vimMode />));
    expect(container.querySelector(".cm-editor")).not.toBeNull();
    expect(container.querySelector(".cm-vim-panel")).not.toBeNull();

    act(() => root.unmount());
  });

  test("updates its document when the controlled value changes", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onChange = vi.fn();

    act(() => root.render(<CodeEditor value="before" onChange={onChange} />));
    act(() => root.render(<CodeEditor value="after" onChange={onChange} />));
    expect(container.querySelector(".cm-editor")?.textContent).toContain("after");

    act(() => root.unmount());
  });

  test("moves the selection to a requested navigation position", () => {
    const container = document.createElement("div"); document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<CodeEditor value="0123456789" onChange={vi.fn()} navigation={{ offset: 6 }} />));
    const view = EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement)!;
    expect(view.state.selection.main.head).toBe(6);
    act(() => root.unmount());
  });

  test("localizes Vim mode, command prompts, and notifications", async () => {
    vi.stubGlobal("requestAnimationFrame", () => 0);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<CodeEditor value="alpha beta" onChange={vi.fn()} vimMode />));
      const view = EditorView.findFromDOM(container.querySelector(".cm-editor")!)!;
      const editor = getCM(view)!;
      const panel = container.querySelector(".cm-vim-panel")!;
      expect(panel.textContent).toBe("--ノーマル--");

      await act(async () => { Vim.handleKey(editor, "i", "user"); });
      expect(panel.textContent).toBe("--挿入--");
      await act(async () => { Vim.handleKey(editor, "<Esc>", "user"); });
      expect(panel.textContent).toBe("--ノーマル--");

      await act(async () => { Vim.handleKey(editor, ":", "user"); });
      const input = panel.querySelector("input")!;
      expect(input.getAttribute("aria-label")).toBe("Vim コマンド");
      expect(document.activeElement).toBe(input);
      input.value = "unknownCommand";
      await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter", keyCode: 13, bubbles: true, cancelable: true,
      })));
      expect(panel.querySelector(".cm-vim-message")?.textContent).toBe("不明な Vim コマンドです。:unknownCommand");
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });

  test("keeps the editor, selection, and undo history when toggling Vim", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onChange = vi.fn();
    const render = (vimMode: boolean, value: string) => act(() => root.render(
      <CodeEditor value={value} onChange={onChange} vimMode={vimMode} initialCursorPosition={4} />,
    ));
    try {
      render(false, "0123456789");
      const editor = container.querySelector<HTMLElement>(".cm-editor")!;
      const view = EditorView.findFromDOM(editor)!;
      expect(view.state.selection.main.head).toBe(4);
      act(() => view.dispatch({ changes: { from: 4, insert: "!" }, selection: { anchor: 5 } }));
      render(true, "0123!456789");
      expect(EditorView.findFromDOM(editor)).toBe(view);
      expect(view.state.selection.main.head).toBe(5);
      expect(container.querySelector(".cm-vim-panel")).not.toBeNull();
      render(false, "0123!456789");
      expect(container.querySelector(".cm-editor")).toBe(editor);
      expect(view.state.selection.main.head).toBe(5);
      expect(container.querySelector(".cm-vim-panel")).toBeNull();
      act(() => view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", {
        key: "z", ctrlKey: true, bubbles: true, cancelable: true,
      })));
      expect(view.state.doc.toString()).toBe("0123456789");
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  test("highlights broken package link destinations", () => {
    const container = document.createElement("div"); document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<CodeEditor value="[Missing](missing.md)" onChange={vi.fn()}
      diagnosticRanges={[{ from: 10, to: 20 }]} />));
    expect(container.querySelector(".cm-broken-package-link")?.textContent).toBe("missing.md");
    act(() => root.unmount());
  });

  test("preserves scroll when a controlled update inserts dropped content", () => {
    const restoreFrames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      restoreFrames.push(callback); return restoreFrames.length;
    });
    const container = document.createElement("div"); document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<CodeEditor value={"line\n".repeat(100)} onChange={vi.fn()} />));
    const scroller = container.querySelector(".cm-scroller") as HTMLElement;
    scroller.scrollTop = 320;
    scroller.scrollLeft = 24;
    act(() => root.render(<CodeEditor value={`[link](target.md)\n${"line\n".repeat(100)}`}
      onChange={vi.fn()} />));
    scroller.scrollTop = 0;
    scroller.scrollLeft = 0;
    act(() => { while (restoreFrames.length > 0) restoreFrames.shift()?.(0); });
    expect(scroller.scrollTop).toBe(320);
    expect(scroller.scrollLeft).toBe(24);
    act(() => root.unmount());
    vi.unstubAllGlobals();
  });

  test("reports selection changes", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onSelectionChange = vi.fn();

    act(() => root.render(
      <CodeEditor value="hello world" onChange={vi.fn()} onSelectionChange={onSelectionChange} />,
    ));
    const editorElement = container.querySelector(".cm-editor") as HTMLElement;
    const view = EditorView.findFromDOM(editorElement)!;
    act(() => {
      view.dispatch({ selection: { anchor: 0, head: 5 } });
    });
    expect(onSelectionChange).toHaveBeenCalled();
    const calls = onSelectionChange.mock.calls;
    const lastCall = calls[calls.length - 1]?.[0];
    expect(lastCall).toMatchObject({ from: 0, to: 5, text: "hello" });

    act(() => {
      view.dispatch({ selection: { anchor: 3 } });
    });
    const calls2 = onSelectionChange.mock.calls;
    expect(calls2[calls2.length - 1]?.[0]).toBeNull();

    act(() => root.unmount());
  });

  test.each([false, true])("separates search shortcuts with Vim = %s", (vimMode) => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const openPackageSearch = vi.fn();
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.defaultPrevented && isPackageSearchShortcut(event)) openPackageSearch();
    };
    window.addEventListener("keydown", onKeyDown);
    try {
      act(() => root.render(<CodeEditor value="hello world" onChange={vi.fn()} vimMode={vimMode} />));
      const editor = container.querySelector<HTMLElement>(".cm-content")!;
      const press = (shiftKey: boolean) => act(() => editor.dispatchEvent(new KeyboardEvent("keydown", {
        key: shiftKey ? "F" : "f", code: "KeyF", ctrlKey: true, shiftKey, bubbles: true, cancelable: true,
      })));
      editor.focus();
      press(true);
      expect(openPackageSearch).toHaveBeenCalledOnce();
      expect(container.querySelector(".cm-search")).toBeNull();
      press(false);
      expect(container.querySelector(".cm-search input")).not.toBeNull();
      expect(openPackageSearch).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener("keydown", onKeyDown);
      act(() => root.unmount());
    }
  });

  test("opens an AI context menu on right-click with a selection", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onAiSelection = vi.fn();

    act(() => root.render(
      <CodeEditor value="hello world" onChange={vi.fn()} onAiSelection={onAiSelection} />,
    ));
    const editorElement = container.querySelector(".cm-editor") as HTMLElement;
    const view = EditorView.findFromDOM(editorElement)!;
    act(() => {
      view.dispatch({ selection: { anchor: 0, head: 5 } });
    });
    const contentElement = editorElement.querySelector(".cm-content") as HTMLElement;
    act(() => {
      contentElement.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true, cancelable: true, clientX: 110, clientY: 120,
      }));
    });
    const menu = document.querySelector(".editor-context-menu") as HTMLDivElement;
    expect(menu).not.toBeNull();
    const buttons = [...menu.querySelectorAll("button")].map((b) => b.textContent);
    expect(buttons).toEqual(["コピー", "切り取り", "貼り付け", "削除", "AI"]);

    expect(document.activeElement?.textContent).toBe("コピー");
    const key = (key: string) => act(() => document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    ));
    key("End");
    expect(document.activeElement?.textContent).toBe("AI");
    key("ArrowRight");
    expect(document.activeElement?.textContent).toBe("書き換え");
    key("Escape");
    expect(document.activeElement?.textContent).toBe("AI");
    key("ArrowRight");
    act(() => (document.activeElement as HTMLButtonElement).click());
    expect(onAiSelection).toHaveBeenCalledWith("Rewrite");
    expect(document.querySelector(".editor-context-menu")).toBeNull();
    expect(document.activeElement).toBe(contentElement);

    act(() => root.unmount());
  });

  test("opens the context menu without a selection and disables edit actions", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => root.render(<CodeEditor value="hello world" onChange={vi.fn()} />));
    const editorElement = container.querySelector(".cm-editor") as HTMLElement;
    const view = EditorView.findFromDOM(editorElement)!;
    act(() => {
      view.dispatch({ selection: { anchor: 3 } });
    });
    const contentElement = editorElement.querySelector(".cm-content") as HTMLElement;
    act(() => {
      contentElement.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true, cancelable: true, clientX: 110, clientY: 120,
      }));
    });
    const menu = document.querySelector(".editor-context-menu") as HTMLDivElement;
    expect(menu).not.toBeNull();
    const buttons = [...menu.querySelectorAll("button")].map((b) => b.textContent);
    expect(buttons).toEqual(["コピー", "切り取り", "貼り付け", "削除", "AI"]);

    act(() => root.unmount());
  });

  test("opens the context menu without a selection and disables edit actions", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => root.render(<CodeEditor value="hello world" onChange={vi.fn()} />));
    const editorElement = container.querySelector(".cm-editor") as HTMLElement;
    const view = EditorView.findFromDOM(editorElement)!;
    act(() => {
      view.dispatch({ selection: { anchor: 3 } });
    });
    const contentElement = editorElement.querySelector(".cm-content") as HTMLElement;
    act(() => {
      contentElement.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true, cancelable: true, clientX: 110, clientY: 120,
      }));
    });
    const menu = document.querySelector(".editor-context-menu") as HTMLDivElement;
    expect(menu).not.toBeNull();
    const buttons = [...menu.querySelectorAll("button")].map((b) => b.textContent);
    expect(buttons).toEqual(["コピー", "切り取り", "貼り付け", "削除", "AI"]);

    act(() => root.unmount());
  });

  test("copy writes the selected text to the clipboard", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => root.render(<CodeEditor value="hello world" onChange={vi.fn()} />));
    const editorElement = container.querySelector(".cm-editor") as HTMLElement;
    const view = EditorView.findFromDOM(editorElement)!;
    act(() => {
      view.dispatch({ selection: { anchor: 0, head: 5 } });
    });
    const contentElement = editorElement.querySelector(".cm-content") as HTMLElement;
    act(() => {
      contentElement.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true, cancelable: true, clientX: 110, clientY: 120,
      }));
    });
    const menu = document.querySelector(".editor-context-menu") as HTMLDivElement;
    const copyBtn = menu.querySelectorAll("button")[0] as HTMLButtonElement;
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    act(() => copyBtn.click());
    expect(writeText).toHaveBeenCalledWith("hello");
    expect(document.querySelector(".editor-context-menu")).toBeNull();

    act(() => root.unmount());
  });

  test("cut deletes the selection and copies it to the clipboard", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onChange = vi.fn();

    act(() => root.render(<CodeEditor value="hello world" onChange={onChange} />));
    const editorElement = container.querySelector(".cm-editor") as HTMLElement;
    const view = EditorView.findFromDOM(editorElement)!;
    act(() => {
      view.dispatch({ selection: { anchor: 0, head: 5 } });
    });
    const contentElement = editorElement.querySelector(".cm-content") as HTMLElement;
    act(() => {
      contentElement.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true, cancelable: true, clientX: 110, clientY: 120,
      }));
    });
    const menu = document.querySelector(".editor-context-menu") as HTMLDivElement;
    const cutBtn = menu.querySelectorAll("button")[1] as HTMLButtonElement;
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    act(() => cutBtn.click());
    expect(writeText).toHaveBeenCalledWith("hello");
    expect(onChange).toHaveBeenCalledWith(" world");

    act(() => root.unmount());
  });

  test("delete removes the selected text", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onChange = vi.fn();

    act(() => root.render(<CodeEditor value="hello world" onChange={onChange} />));
    const editorElement = container.querySelector(".cm-editor") as HTMLElement;
    const view = EditorView.findFromDOM(editorElement)!;
    act(() => {
      view.dispatch({ selection: { anchor: 0, head: 5 } });
    });
    const contentElement = editorElement.querySelector(".cm-content") as HTMLElement;
    act(() => {
      contentElement.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true, cancelable: true, clientX: 110, clientY: 120,
      }));
    });
    const menu = document.querySelector(".editor-context-menu") as HTMLDivElement;
    const deleteBtn = menu.querySelectorAll("button")[3] as HTMLButtonElement;
    act(() => deleteBtn.click());
    expect(onChange).toHaveBeenCalledWith(" world");

    act(() => root.unmount());
  });

  test(":w saves while Vim mode is enabled", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onSave = vi.fn();

    act(() => root.render(
      <CodeEditor value="content" onChange={vi.fn()} vimMode onSave={onSave} />,
    ));
    const editorElement = container.querySelector(".cm-editor") as HTMLElement;
    const view = EditorView.findFromDOM(editorElement);
    const vimEditor = getCM(view!);
    act(() => Vim.handleEx(vimEditor as CodeMirrorV, "w"));
    expect(onSave).toHaveBeenCalledOnce();

    act(() => root.unmount());
  });
});
