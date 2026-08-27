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
    expect(buttons).toEqual(["コピー", "切り取り", "貼り付け", "削除", "Rewrite", "Summarize", "Proofread"]);

    const rewrite = menu.querySelectorAll("button")[4] as HTMLButtonElement;
    act(() => rewrite.click());
    expect(onAiSelection).toHaveBeenCalledWith("Rewrite");
    expect(document.querySelector(".editor-context-menu")).toBeNull();

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
    expect(buttons).toEqual(["コピー", "切り取り", "貼り付け", "削除", "Rewrite", "Summarize", "Proofread"]);

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
    expect(buttons).toEqual(["コピー", "切り取り", "貼り付け", "削除", "Rewrite", "Summarize", "Proofread"]);

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
