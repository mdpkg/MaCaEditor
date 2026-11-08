import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { open, save } from "@tauri-apps/plugin-dialog";
import App from "./App";
import * as diagnostics from "./lib/packageDiagnostics";
import { saveEditorPreferences } from "./lib/editorPreferences";
import * as tauri from "./lib/tauri";
import type { PackageInfo } from "./types";
import type { TextEditGroup } from "./lib/packageHistory";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("./lib/tauri", async (importOriginal) => ({
  ...await importOriginal<typeof tauri>(),
  openPackage: vi.fn(),
  openFolder: vi.fn(),
  savePackage: vi.fn(),
  saveFolder: vi.fn(),
  exportPackage: vi.fn(),
  watchFolder: vi.fn(),
  watchPrint: vi.fn(),
  closePrintPreview: vi.fn(),
  stopWatchingFolder: vi.fn(),
  onFolderChanged: vi.fn(),
  onNativeFileDrop: vi.fn(),
  readImage: vi.fn(),
  hasAiConfiguration: vi.fn(),
}));
vi.mock("./lib/editorPreferences", () => ({
  loadVimMode: async () => false,
  loadShowToc: async () => false,
  loadRspressMode: async () => false,
  loadDrawingPreferences: async () => ({ gridVisible: true, snap: false, smartGuidesEnabled: true }),
  saveEditorPreferences: vi.fn(),
}));
vi.mock("./components/MarkdownPreview", () => ({
  MarkdownPreview: ({ markdown, onEditTable }: {
    markdown: string;
    onEditTable: (start: number, end: number) => void;
  }) => <>
    <p>{markdown}</p>
    {markdown.includes("|") && (
      <button onClick={() => onEditTable(markdown.indexOf("|"), markdown.lastIndexOf("|") + 1)}>Edit test table</button>
    )}
  </>,
}));
vi.mock("./components/MarkdownEditor", () => ({
  MarkdownEditor: ({ value, onChange, initialCursorPosition, initialScrollTop, onCursorChange, onScrollTopChange, navigation }: {
    value: string;
    onChange: (value: string, group?: TextEditGroup) => void;
    initialCursorPosition?: number;
    initialScrollTop?: number;
    navigation?: { offset: number; length?: number };
    onCursorChange: (position: number) => void;
    onScrollTopChange: (position: number) => void;
  }) => <textarea value={value} data-cursor={initialCursorPosition} data-scroll={initialScrollTop} data-navigation={JSON.stringify(navigation)}
    onClick={(event) => onCursorChange(event.currentTarget.selectionStart)}
    onScroll={(event) => onScrollTopChange(event.currentTarget.scrollTop)}
    onChange={(event) => onChange(event.currentTarget.value, (event.nativeEvent as CustomEvent<TextEditGroup>).detail)} />,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function documentInfo(content: string): PackageInfo {
  return {
    manifest: { version: "2.0", entrypoint: "index.md" },
    entrypoint: "index.md",
    files: [{ path: "index.md", content, is_text: true, base64: null }],
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("App persistence", () => {
  const folderPath = "C:/documents/source";
  let root: Root;
  let container: HTMLDivElement;
  let folderChanged: (path: string) => void;
  let nativeDrop: (paths: string[], action?: tauri.NativeFileDropAction) => void;

  beforeEach(async () => {
    vi.resetAllMocks();
    localStorage.clear();
    vi.mocked(tauri.onNativeFileDrop).mockImplementation(async (callback) => { nativeDrop = callback; return () => {}; });
    vi.mocked(tauri.onFolderChanged).mockImplementation(async (callback) => {
      folderChanged = callback;
      return () => {};
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<App />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function button(label: string, scope: ParentNode = container): HTMLButtonElement {
    const match = [...scope.querySelectorAll("button")].find((item) => item.textContent === label);
    if (!match) throw new Error(`Missing button: ${label}`);
    return match;
  }

  async function click(label: string, scope?: ParentNode) {
    await act(async () => button(label, scope).click());
  }

  async function edit(value: string, group?: TextEditGroup) {
    const editor = container.querySelector("textarea");
    if (!editor) throw new Error("Missing editor");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(editor, value);
      editor.dispatchEvent(new CustomEvent("input", { bubbles: true, detail: group }));
    });
  }

  function saveShortcut() {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, cancelable: true }));
  }

  async function historyShortcut(key: string) {
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key, ctrlKey: true, cancelable: true }));
    });
  }

  test("opens package search only for an unhandled shifted shortcut and returns focus on Escape", async () => {
    vi.mocked(open).mockResolvedValue("original.mdpkg");
    vi.mocked(tauri.openPackage).mockResolvedValue(documentInfo("Disk"));
    await click("ファイル");
    await click("開く");
    await click("編集");
    const editor = container.querySelector("textarea")!;
    editor.focus();
    const press = (shiftKey: boolean, handled = false) => act(() => {
      const event = new KeyboardEvent("keydown", {
        key: shiftKey ? "F" : "f", shiftKey, ctrlKey: true, bubbles: true, cancelable: true,
      });
      if (handled) event.preventDefault();
      editor.dispatchEvent(event);
    });
    press(false);
    press(true, true);
    expect(container.querySelector(".package-search-dialog")).toBeNull();
    press(true);
    const search = container.querySelector<HTMLInputElement>('.package-search-dialog input[type="search"]')!;
    expect(document.activeElement).toBe(search);
    act(() => search.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(container.querySelector(".package-search-dialog")).toBeNull();
    expect(document.activeElement).toBe(editor);
  });

  async function inputValue(input: HTMLInputElement | HTMLSelectElement, value: string) {
    await act(async () => {
      const select = input instanceof HTMLSelectElement;
      Object.getOwnPropertyDescriptor(select ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event(select ? "change" : "input", { bubbles: true }));
    });
  }

  test("renames with a fixed extension, picks a move folder, and confirms deletion in the app", async () => {
    vi.mocked(open).mockResolvedValue("original.mdpkg");
    const info = documentInfo("[Guide](docs/guide.md)");
    info.files.push({ path: "docs/guide.md", content: "Guide", is_text: true, base64: null });
    vi.mocked(tauri.openPackage).mockResolvedValue(info);
    await click("開く", container.querySelector(".empty-state")!);
    const nativePrompt = vi.spyOn(window, "prompt");
    const nativeConfirm = vi.spyOn(window, "confirm");
    const context = async (path: string, command: string) => {
      await act(async () => container.querySelector<HTMLElement>(`[data-path="${path}"]`)!.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      ));
      const menu = document.querySelector(".file-tree-context-menu")!;
      await click(command, menu);
    };
    await context("docs/guide.md", "名前を変更");
    let dialog = container.querySelector(".about-dialog")!;
    expect(dialog.textContent).toContain(".md");
    let input = dialog.querySelector("input")!;
    expect(input.value).toBe("guide");
    await inputValue(input, "bad/name");
    expect(button("名前を変更", dialog).disabled).toBe(true);
    await inputValue(input, "renamed");
    await click("名前を変更", dialog);
    expect(container.querySelector('[data-path="docs/renamed.md"]')).not.toBeNull();

    await context("docs/renamed.md", "移動");
    dialog = container.querySelector(".about-dialog")!;
    await act(async () => dialog.querySelector<HTMLInputElement>('input[type="radio"][value=""]')!.click());
    await click("移動", dialog);
    expect(container.querySelector('[data-path="renamed.md"]')).not.toBeNull();

    await context("renamed.md", "削除");
    dialog = container.querySelector(".about-dialog")!;
    expect(dialog.textContent).toContain("参照が 1 件");
    await click("キャンセル", dialog);
    expect(container.querySelector('[data-path="renamed.md"]')).not.toBeNull();
    await context("renamed.md", "削除");
    await click("削除", container.querySelector(".about-dialog")!);
    expect(container.querySelector('[data-path="renamed.md"]')).toBeNull();
    expect(nativePrompt).not.toHaveBeenCalled();
    expect(nativeConfirm).not.toHaveBeenCalled();
  });

  test("adds items in the tree without closing the open Markdown or discarding another empty folder", async () => {
    const info = documentInfo("Original");
    info.files.push({ path: "docs/guide.md", content: "Guide", is_text: true, base64: null });
    vi.mocked(tauri.openPackage).mockResolvedValue(info);
    await act(async () => nativeDrop(["original.mdpkg"]));
    const row = (path: string) => container.querySelector<HTMLElement>(`[data-path="${path}"]`);
    const openAdd = async (path: string, command: string) => {
      await act(async () => row(path)!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
      await click(command, document.querySelector(".file-tree-context-menu")!);
      expect(container.querySelector('[role="dialog"]')).toBeNull();
      return container.querySelector<HTMLElement>(".tree-inline-add")!;
    };

    let form = await openAdd("docs", "フォルダを追加");
    expect(form.textContent).toContain("空のフォルダは保存されません");
    await inputValue(form.querySelector("input")!, "empty");
    await click("追加", form);
    expect(row("docs/empty")).not.toBeNull();
    expect(container.querySelector(".document-area")?.textContent).toContain("Original");

    form = await openAdd("docs/guide.md", "Markdown を追加");
    await inputValue(form.querySelector("input")!, "guide.md");
    await click("追加", form);
    expect(form.querySelector('[role="alert"]')?.textContent).toBe("このパスは既に存在します。");
    await inputValue(form.querySelector("input")!, "new.md");
    await click("追加", form);
    expect(row("docs/empty")).not.toBeNull();
    expect(row("docs/new.md")?.getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector("textarea")?.value).toBe("# new\n");
  });

  test("explains why PDF and ZIP attachments have no preview while showing PNG images", async () => {
    vi.mocked(open).mockResolvedValue("attachments.mdpkg");
    const info = documentInfo("Original");
    const paths = ["attachments/document.pdf", "attachments/archive.ZIP", "attachments/image.png"];
    info.files.push(...paths.map((path) => ({ path, content: null, is_text: false, base64: "AA==" })));
    vi.mocked(tauri.openPackage).mockResolvedValue(info);
    await click("開く", container.querySelector(".empty-state")!);

    for (const path of paths.slice(0, 2)) {
      await act(async () => container.querySelector<HTMLElement>(`[data-path="${path}"]`)!.click());
      const view = container.querySelector(".binary-view")!;
      expect(view.textContent).toContain(path);
      expect(view.textContent).toContain("このファイルはプレビューできません。");
      expect(view.querySelector("img")).toBeNull();
    }

    await act(async () => container.querySelector<HTMLElement>('[data-path="attachments/image.png"]')!.click());
    const view = container.querySelector(".binary-view")!;
    expect(view.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,AA==");
    expect(view.textContent).not.toContain("このファイルはプレビューできません。");
  });

  test("reports a preference autosave failure and clears it after a successful retry", async () => {
    const detail = "アクセスが拒否されました。 (os error 5)";
    vi.mocked(saveEditorPreferences).mockRejectedValueOnce(detail).mockResolvedValueOnce();
    const vim = [...container.querySelectorAll("label")].find((label) => label.textContent?.trim() === "Vim モード")!
      .querySelector("input")!;
    await act(async () => vim.click());
    expect(vim.checked).toBe(true);
    const summary = "エディタ設定の保存に失敗しました。詳しくは詳細欄を確認してください。";
    const banner = container.querySelector(".operation-error")!;
    expect(banner.querySelector('[role="alert"]')?.textContent).toBe(summary);
    expect(container.querySelector(".status-message")?.textContent).toBe(summary);
    expect(banner.querySelector("details")?.open).toBe(false);
    expect(banner.querySelector(".error-detail")?.textContent).toBe(detail);
    await act(async () => vim.click());
    expect(container.querySelector(".operation-error")).toBeNull();
    expect(container.querySelector(".status-message")?.textContent).toBe("エディタ設定を保存しました。");
  });

  test.each([
    ["jobFailed", "印刷", "Win32 エラー コード: 5\nアクセスが拒否されました。\n"],
    ["monitoringFailed", "印刷状態の監視", "The handle is invalid. (os error 6)"],
  ] as const)("shows a Windows print error of kind %s in Japanese", async (kind, operation, detail) => {
    vi.mocked(open).mockResolvedValue("original.mdpkg");
    vi.mocked(tauri.openPackage).mockResolvedValue(documentInfo("Original"));
    await click("開く", container.querySelector(".empty-state")!);
    vi.mocked(tauri.watchPrint).mockResolvedValue("MaCa Editor [print-id]");
    vi.mocked(tauri.closePrintPreview).mockResolvedValue(undefined);
    const print = vi.spyOn(window, "print").mockImplementation(() => {
      expect(document.title).toBe("MaCa Editor [print-id] — original.mdpkg — MaCa Editor");
    });
    await click("ファイル");
    await click("印刷");
    expect(print).toHaveBeenCalledOnce();
    expect(tauri.closePrintPreview).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("afterprint"));
    window.dispatchEvent(new Event("afterprint"));
    expect(tauri.closePrintPreview).toHaveBeenCalledOnce();
    expect(tauri.closePrintPreview).toHaveBeenCalledWith("MaCa Editor [print-id]");
    expect(document.title).toBe("original.mdpkg — MaCa Editor");

    act(() => vi.mocked(tauri.watchPrint).mock.calls[0][0]({ kind, detail }));
    const summary = `${operation}に失敗しました。詳しくは詳細欄を確認してください。`;
    const banner = container.querySelector(".operation-error")!;
    expect(banner.querySelector('[role="alert"]')?.textContent).toBe(summary);
    expect(container.querySelector(".status-message")?.textContent).toBe(summary);
    expect(banner.querySelector("details")?.open).toBe(false);
    expect(banner.querySelector(".error-detail")?.textContent).toBe(detail);
  });

  test("reports a rejected native print request and allows retrying", async () => {
    vi.mocked(open).mockResolvedValue("original.mdpkg");
    vi.mocked(tauri.openPackage).mockResolvedValue(documentInfo("Original"));
    await click("開く", container.querySelector(".empty-state")!);
    const detail = "plugin:webview|print rejected the request";
    const print = vi.spyOn(window, "print").mockRejectedValueOnce(detail).mockImplementation(() => {});

    await click("ファイル");
    await click("印刷");

    const summary = "印刷に失敗しました。詳しくは詳細欄を確認してください。";
    const banner = container.querySelector(".operation-error")!;
    expect(banner.querySelector('[role="alert"]')?.textContent).toBe(summary);
    expect(container.querySelector(".status-message")?.textContent).toBe(summary);
    expect(banner.querySelector(".error-detail")?.textContent).toBe(detail);

    await click("ファイル");
    await click("印刷");
    expect(print).toHaveBeenCalledTimes(2);
  });

  test("keeps a move collision with a Japanese path in the error details", async () => {
    vi.mocked(open).mockResolvedValue("original.mdpkg");
    const info = documentInfo("Original");
    info.manifest.resources = [{ type: "mermaid", source: "origin/diagram.mmd", rendered: "origin/重複.svg" }];
    info.files.push(
      { path: "origin/diagram.mmd", content: "flowchart LR\nA --> B", is_text: true, base64: null },
      { path: "origin/重複.svg", content: "<svg/>", is_text: true, base64: null },
      { path: "target/重複.svg", content: "<svg/>", is_text: true, base64: null },
    );
    vi.mocked(tauri.openPackage).mockResolvedValue(info);
    await click("開く", container.querySelector(".empty-state")!);

    const source = container.querySelector('[data-path="origin/diagram.mmd"]')!;
    await act(async () => source.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    await click("移動", document.querySelector(".file-tree-context-menu")!);
    const dialog = container.querySelector('[role="dialog"]')!;
    await act(async () => dialog.querySelector<HTMLInputElement>('input[type="radio"][value="target"]')!.click());
    await click("移動", dialog);

    const summary = "移動に失敗しました。詳しくは詳細欄を確認してください。";
    const banner = container.querySelector(".operation-error")!;
    expect(banner.querySelector('[role="alert"]')?.textContent).toBe(summary);
    expect(container.querySelector(".status-message")?.textContent).toBe(summary);
    const details = banner.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")?.textContent).toBe("詳細");
    act(() => details.querySelector("summary")!.click());
    expect(details.open).toBe(true);
    expect(details.querySelector(".error-detail")?.textContent).toBe("Path already exists: target/重複.svg");
    expect(container.querySelector('[data-path="origin/diagram.mmd"]')).not.toBeNull();
    expect(container.querySelector('[data-path="target/diagram.mmd"]')).toBeNull();
  });

  test("filters files, selects folders, and retains folder collapse across sidebar remounts", async () => {
    vi.mocked(open).mockResolvedValue("original.mdpkg");
    const info = documentInfo("Original");
    info.files.push({ path: "docs/guide.md", content: "Guide", is_text: true, base64: null });
    vi.mocked(tauri.openPackage).mockResolvedValue(info);
    await click("開く", container.querySelector(".empty-state")!);
    let folder = container.querySelector<HTMLElement>('[data-path="docs"]')!;
    await act(async () => folder.click());
    expect(folder.getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector("textarea")?.value).toBe("Original");
    await act(async () => folder.querySelector<HTMLElement>(".tree-item-disclosure")!.click());
    expect(folder.getAttribute("aria-expanded")).toBe("false");
    await click("☰");
    await click("☰");
    folder = container.querySelector<HTMLElement>('[data-path="docs"]')!;
    expect(folder.getAttribute("aria-expanded")).toBe("false");
    const filter = container.querySelector<HTMLInputElement>(".tree-filter input")!;
    await inputValue(filter, "guide");
    expect(container.querySelector('[data-path="docs/guide.md"]')).not.toBeNull();
    expect(container.querySelector('[data-path="index.md"]')).toBeNull();
    await inputValue(filter, "");
    expect(container.querySelector('[data-path="docs/guide.md"]')).toBeNull();

    await click("ファイル");
    await click("フォルダを追加...");
    const dialog = container.querySelector(".about-dialog")!;
    expect(dialog.textContent).toContain("空のフォルダは保存されません");
    expect(dialog.querySelector("input")?.value).toBe("docs/folder");
    await click("キャンセル", dialog);
  });

  test("reopens recent documents and exposes AI settings and keyboard help from the empty state", async () => {
    const empty = container.querySelector(".empty-state")!;
    expect([...empty.querySelectorAll("button")].map((item) => item.textContent)).toEqual(["新規作成", "開く", "フォルダを開く..."]);
    vi.mocked(tauri.hasAiConfiguration).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await click("AI");
    let aiMenu = container.querySelector('[role="menu"]')!;
    expect(aiMenu.textContent).toContain("AI が設定されていません。");
    expect([...aiMenu.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)).toEqual(["AI を設定する"]);
    await click("AI を設定する", aiMenu);
    expect(container.querySelector(".about-dialog")?.textContent).toContain("AI 設定");
    await click("閉じる", container.querySelector(".about-dialog")!);
    await click("AI");
    aiMenu = container.querySelector('[role="menu"]')!;
    expect(aiMenu.textContent).toContain("Markdown ファイルを開く");
    expect([...aiMenu.querySelectorAll("button:disabled")].map((item) => item.textContent)).toEqual(["書き換え", "要約", "校正"]);
    await click("ヘルプ");
    await click("キーボードショートカット");
    expect(container.querySelector(".shortcut-list")?.textContent).toContain("Ctrl/Cmd+Shift+F");
    await click("閉じる", container.querySelector(".about-dialog")!);
    vi.mocked(open).mockResolvedValue("original.mdpkg");
    vi.mocked(tauri.openPackage).mockResolvedValue(documentInfo("Original"));
    await click("開く", empty);
    expect(document.title).toBe("original.mdpkg — MaCa Editor");
    const editor = container.querySelector("textarea");
    expect(editor?.value).toBe("Original");
    expect(JSON.parse(editor!.dataset.navigation!)).toEqual({ offset: 0, length: 0, path: "index.md" });
    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(<App />));
    expect(container.querySelector(".recent-documents")?.textContent).toContain("original.mdpkg");
    await click("original.mdpkg", container.querySelector(".recent-documents")!);
    expect(tauri.openPackage).toHaveBeenCalledTimes(2);
    expect(container.querySelector(".document-area")?.textContent).toContain("Original");
    expect(container.querySelector(".document-area textarea")).toBeNull();
  });

  test("restores a different folder collapse for each reopened package after remounting the app", async () => {
    const info = documentInfo("Original");
    info.files.push(
      { path: "docs/guide.md", content: "Guide", is_text: true, base64: null },
      { path: "notes/note.md", content: "Note", is_text: true, base64: null },
    );
    vi.mocked(tauri.openPackage).mockResolvedValue(info);
    const row = (path: string) => container.querySelector(`[data-path="${path}"]`)!;
    const toggle = (path: string) => act(async () => row(path).querySelector<HTMLElement>(".tree-item-disclosure")!.click());

    await act(async () => nativeDrop(["first.mdpkg"]));
    await toggle("docs");
    await act(async () => nativeDrop(["second.mdpkg"]));
    expect(row("docs").getAttribute("aria-expanded")).toBe("true");
    await toggle("notes");

    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(<App />));
    await act(async () => nativeDrop(["first.mdpkg"]));
    expect(row("docs").getAttribute("aria-expanded")).toBe("false");
    expect(row("notes").getAttribute("aria-expanded")).toBe("true");
    await act(async () => nativeDrop(["second.mdpkg"]));
    expect(row("docs").getAttribute("aria-expanded")).toBe("true");
    expect(row("notes").getAttribute("aria-expanded")).toBe("false");
  });


  test("opens native drops with discard confirmation and preserves edits made while reading dropped images", async () => {
    vi.mocked(tauri.openPackage).mockResolvedValue(documentInfo("Original"));
    await act(async () => nativeDrop(["original.mdpkg"], "package"));
    await click("編集");
    await edit("Unsaved");
    vi.mocked(tauri.openFolder).mockResolvedValue(documentInfo("Folder"));
    await act(async () => nativeDrop(["C:/folder.png"], "folder"));
    await click("キャンセル", container.querySelector(".about-dialog")!);
    expect(container.querySelector("textarea")?.value).toBe("Unsaved");
    await act(async () => nativeDrop(["C:/folder.png"], "folder"));
    await click("破棄して続行", container.querySelector(".about-dialog")!);
    expect(container.querySelector(".document-area")?.textContent).toContain("Folder");
    await click("編集");
    let finishRead!: (image: { file_name: string; base64: string }) => void;
    vi.mocked(tauri.readImage).mockImplementation(() => new Promise((resolve) => { finishRead = resolve; }));
    await act(async () => nativeDrop(["C:/photo.png"], "images"));
    await edit("Latest edit");
    await act(async () => finishRead({ file_name: "photo.png", base64: "aGVsbG8=" }));
    expect(container.querySelector("textarea")?.value).toContain("Latest edit");
    expect(container.querySelector('[data-path="images/photo.png"]')).not.toBeNull();
  });

  test("reports successful, excluded and failed dropped images separately", async () => {
    vi.mocked(tauri.openPackage).mockResolvedValue(documentInfo("Original"));
    await act(async () => nativeDrop(["original.mdpkg"]));
    vi.mocked(tauri.readImage).mockImplementation(async (path) => {
      if (path.endsWith("bad.png")) throw new Error("unreadable");
      if (path.endsWith("missing.png")) throw "  File not found (os error 2)\n";
      return { file_name: "good.png", base64: "aGVsbG8=" };
    });
    await act(async () => nativeDrop(["C:/good.png", "C:/bad.png", "C:/skip.svg", "C:/missing.png"], "images"));
    expect(container.querySelector('[data-path="images/good.png"]')).not.toBeNull();
    expect(container.querySelector('[data-path="images/bad.png"]')).toBeNull();
    const warning = container.querySelector(".notification-banner-warning")!;
    const summary = warning.querySelector('[role="status"]')?.textContent;
    expect(summary).toContain("取り込み 1 件: good.png");
    expect(summary).toContain("除外 1 件（非対応形式）: skip.svg");
    expect(summary).toContain("失敗 2 件: bad.png、missing.png");
    expect(summary).not.toContain("unreadable");
    const details = warning.querySelector("details")!;
    expect(details.open).toBe(false);
    act(() => details.querySelector("summary")!.click());
    expect(details.open).toBe(true);
    expect(details.querySelector(".error-detail")?.textContent)
      .toBe("bad.png\nunreadable\n\nmissing.png\n  File not found (os error 2)\n");
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    await click("閉じる", warning);
    expect(container.querySelector(".notification-banner-warning")).toBeNull();
    await click("通知履歴", container.querySelector(".status-bar")!);
    const history = container.querySelector('[role="dialog"]')!;
    const entry = history.querySelector(".notification-history li")!;
    expect(entry.textContent).toContain(summary!);
    const historyDetails = entry.querySelector("details")!;
    expect(historyDetails.open).toBe(false);
    act(() => historyDetails.querySelector("summary")!.click());
    expect(historyDetails.open).toBe(true);
    expect(historyDetails.querySelector(".error-detail")?.textContent)
      .toBe("bad.png\nunreadable\n\nmissing.png\n  File not found (os error 2)\n");
    await click("閉じる", history);
    expect(container.querySelector(".notification-banner-warning")).toBeNull();
  });

  test("keeps the native image read error out of the summary and status bar", async () => {
    vi.mocked(tauri.openPackage).mockResolvedValue(documentInfo("Original"));
    await act(async () => nativeDrop(["original.mdpkg"]));
    vi.mocked(open).mockResolvedValue(["C:/missing.png"]);
    const detail = "指定されたファイルが見つかりません。 (os error 2)";
    vi.mocked(tauri.readImage).mockRejectedValueOnce(detail);
    await click("画像を追加");
    const summary = "画像の追加に失敗しました。詳しくは詳細欄を確認してください。";
    expect(container.querySelector('.operation-error [role="alert"]')?.textContent).toBe(summary);
    expect(container.querySelector(".status-message")?.textContent).toBe(summary);
    expect(container.querySelector(".operation-error .error-detail")?.textContent).toBe(detail);
  });

  test("confirms root drops and offers safe undo without losing later edits", async () => {
    const info = documentInfo("[Guide](docs/guide.md)");
    info.files.push({ path: "docs/guide.md", content: "Guide", is_text: true, base64: null });
    vi.mocked(tauri.openPackage).mockResolvedValue(info);
    await act(async () => nativeDrop(["original.mdpkg"]));
    const drop = async () => {
      const event = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "dataTransfer", { value: { getData: () => "docs/guide.md" } });
      await act(async () => container.querySelector(".file-tree")!.dispatchEvent(event));
    };
    await drop(); await click("キャンセル", container.querySelector('[role="dialog"]')!);
    expect(container.querySelector('[data-path="docs/guide.md"]')).not.toBeNull();
    await drop(); await click("移動", container.querySelector('[role="dialog"]')!);
    expect(container.querySelector('[data-path="guide.md"]')).not.toBeNull();
    await click("元に戻す", container.querySelector(".notification-banner")!);
    expect(container.querySelector('[data-path="docs/guide.md"]')).not.toBeNull();
    await drop(); await click("移動", container.querySelector('[role="dialog"]')!);
    await click("編集"); await edit("Later edit");
    await click("元に戻す", container.querySelector(".notification-banner")!);
    expect(container.querySelector(".document-area")?.textContent).toContain("Later edit");
    expect(container.querySelector('[data-path="guide.md"]')).not.toBeNull();
  });

  test("undoes and redoes Markdown and a linked file move in order across saving", async () => {
    const info = documentInfo("[Guide](docs/guide.md)");
    info.files.push({ path: "docs/guide.md", content: "[Home](../index.md)", is_text: true, base64: null });
    vi.mocked(tauri.openPackage).mockResolvedValue(info);
    await act(async () => nativeDrop(["original.mdpkg"]));
    await click("編集");
    await edit("[Guide](docs/guide.md)\n\nEntry edit");

    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: { getData: () => "docs/guide.md" } });
    await act(async () => container.querySelector(".file-tree")!.dispatchEvent(drop));
    await click("移動", container.querySelector('[role="dialog"]')!);
    await act(async () => saveShortcut());
    expect(tauri.savePackage).toHaveBeenLastCalledWith(expect.objectContaining({
      files: [
        expect.objectContaining({ path: "index.md", content: "[Guide](guide.md)\n\nEntry edit" }),
        expect.objectContaining({ path: "guide.md", content: "[Home](index.md)" }),
      ],
    }));
    expect(container.querySelector(".dirty-indicator")).toBeNull();

    await act(async () => container.querySelector<HTMLElement>('[data-path="guide.md"]')!.click());
    await historyShortcut("z");
    expect(container.querySelector('[data-path="guide.md"]')).toBeNull();
    expect(container.querySelector('[data-path="docs/guide.md"]')).not.toBeNull();
    expect(container.querySelector(".dirty-indicator")).not.toBeNull();
    await act(async () => container.querySelector<HTMLElement>('[data-path="docs/guide.md"]')!.click());
    expect(container.querySelector(".document-area")?.textContent).toContain("[Home](../index.md)");
    await click("ファイル");
    await click("元に戻す", container.querySelector('[role="menu"]')!);
    expect(container.querySelector(".document-area")?.textContent).toContain("[Guide](docs/guide.md)");
    expect(container.querySelector(".document-area")?.textContent).not.toContain("Entry edit");
    await historyShortcut("y");
    expect(container.querySelector(".document-area")?.textContent).toContain("Entry edit");
    await historyShortcut("y");
    expect(container.querySelector('[data-path="guide.md"]')).not.toBeNull();
    expect(container.querySelector(".dirty-indicator")).toBeNull();
    expect(tauri.savePackage).toHaveBeenCalledTimes(1);
    vi.mocked(tauri.openPackage).mockResolvedValue(info);
    await act(async () => nativeDrop(["original.mdpkg"]));
    await click("ファイル");
    expect(button("元に戻す", container.querySelector('[role="menu"]')!).disabled).toBe(true);
  });

  test("groups continuous typing, splits it at save, and clears redo only for a new edit", async () => {
    vi.mocked(tauri.openPackage).mockResolvedValue(documentInfo("Disk"));
    await act(async () => nativeDrop(["original.mdpkg"]));
    await click("編集");
    const group = {};
    await edit("Disk a", group);
    await edit("Disk ab", group);
    await historyShortcut("z");
    expect(container.querySelector("textarea")?.value).toBe("Disk");
    await edit("Disk");
    await historyShortcut("y");
    expect(container.querySelector("textarea")?.value).toBe("Disk ab");

    await edit("Disk abc", group);
    await act(async () => saveShortcut());
    await edit("Disk abcd", group);
    await historyShortcut("z");
    expect(container.querySelector("textarea")?.value).toBe("Disk abc");
    expect(container.querySelector(".dirty-indicator")).toBeNull();
    await edit("Disk abc!");
    await historyShortcut("y");
    expect(container.querySelector("textarea")?.value).toBe("Disk abc!");
    expect(container.querySelector(".dirty-indicator")).not.toBeNull();
  });

  test("keeps the written version as the baseline when undo happens during a save", async () => {
    vi.mocked(tauri.openPackage).mockResolvedValue(documentInfo("Disk"));
    await act(async () => nativeDrop(["original.mdpkg"]));
    await click("編集");
    await edit("Written");
    const write = deferred();
    vi.mocked(tauri.savePackage).mockReturnValueOnce(write.promise);
    await act(async () => saveShortcut());
    await historyShortcut("z");
    expect(container.querySelector("textarea")?.value).toBe("Disk");
    await act(async () => write.resolve());
    expect(container.querySelector(".dirty-indicator")).not.toBeNull();
    await historyShortcut("y");
    expect(container.querySelector("textarea")?.value).toBe("Written");
    expect(container.querySelector(".dirty-indicator")).toBeNull();
  });

  test("keeps diagnostics open, navigates to the source line, and refreshes after editing", async () => {
    const content = "First\n\nSecond\n[broken](missing.md)";
    vi.mocked(tauri.openPackage).mockResolvedValue(documentInfo(content));
    await act(async () => nativeDrop(["original.mdpkg"]));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await click("ファイル"); await click("パッケージを診断...");
    const panel = container.querySelector(".package-diagnostics-dialog")!;
    await act(async () => (panel.querySelector("li button") as HTMLButtonElement).click());
    expect(JSON.parse(container.querySelector("textarea")!.dataset.navigation!).offset).toBe(content.indexOf("missing.md"));
    expect(container.querySelector(".package-diagnostics-dialog")).not.toBeNull();
    await edit("Fixed");
    await act(async () => vi.advanceTimersByTime(300));
    expect(panel.textContent).toContain("問題はありません");
  });

  test("restores cursor and scroll positions separately for each opened file", async () => {
    vi.mocked(open).mockResolvedValue("original.mdpkg");
    const info = documentInfo("0123456789");
    info.files.push({ ...info.files[0], path: "other.md" });
    vi.mocked(tauri.openPackage).mockResolvedValue(info);
    await click("ファイル");
    await click("開く");
    await click("編集");

    const editor = () => container.querySelector("textarea")!;
    const select = async (path: string) => {
      await act(async () => container.querySelector<HTMLElement>(`[data-path="${path}"]`)!.click());
      await click("編集");
    };
    const move = (cursor: number, scrollTop: number) => act(() => {
      editor().setSelectionRange(cursor, cursor);
      editor().click();
      editor().scrollTop = scrollTop;
      editor().dispatchEvent(new Event("scroll"));
    });

    move(7, 140);
    await select("other.md");
    expect(editor().dataset.cursor).toBeUndefined();
    expect(editor().dataset.scroll).toBeUndefined();
    move(3, 60);
    await select("index.md");
    expect(editor().dataset.cursor).toBe("7");
    expect(editor().dataset.scroll).toBe("140");
    await select("other.md");
    expect(editor().dataset.cursor).toBe("3");
    expect(editor().dataset.scroll).toBe("60");
  });

  test("debounces live diagnostics but validates the latest text on demand", async () => {
    vi.mocked(open).mockResolvedValue("original.mdpkg");
    vi.mocked(tauri.openPackage).mockResolvedValue(documentInfo("Original"));
    await click("ファイル");
    await click("開く");
    const diagnose = vi.spyOn(diagnostics, "diagnosePackage");
    const live = vi.spyOn(diagnostics, "diagnoseRelatedMarkdown");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await click("編集");
    await edit("[Link](first.md)");
    act(() => vi.advanceTimersByTime(250));
    await edit("[Link](latest.md)");
    act(() => vi.advanceTimersByTime(299));
    expect(diagnose).not.toHaveBeenCalled();
    expect(live).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(live).toHaveBeenCalledOnce();
    expect(live.mock.calls[0][1]).toBe("index.md");
    expect(diagnose).not.toHaveBeenCalled();
    await click("ファイル");
    await click("パッケージを診断...");
    expect(container.querySelector(".package-diagnostics-dialog")?.textContent).toContain("latest.md");
    expect(diagnose).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(300));
    expect(diagnose).toHaveBeenCalledTimes(2);
  });

  test("keeps table drafts out of saves and commits only when the user finishes", async () => {
    vi.mocked(open).mockResolvedValue("original.mdpkg");
    const original = "Before\n\n|A|B|\n|---|---|\n|1|2|\n\nAfter";
    vi.mocked(tauri.openPackage).mockResolvedValue(documentInfo(original));
    await click("ファイル");
    await click("開く");
    await click("Edit test table");
    await act(async () => { await import("./components/MarkdownTableEditor"); });
    await click("完了");
    expect(container.querySelector("textarea")?.value).toBe(original);
    expect(container.querySelector(".dirty-indicator")).toBeNull();

    const changeHeader = async () => {
      const cell = container.querySelector<HTMLTextAreaElement>('[aria-label="1 列目の見出し"]')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(cell, "Draft");
        cell.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    await click("Edit test table");
    await changeHeader();
    expect(container.querySelector(".dirty-indicator")).toBeNull();
    await act(async () => saveShortcut());
    expect(tauri.savePackage).toHaveBeenLastCalledWith(expect.objectContaining({
      files: [expect.objectContaining({ content: original })],
    }));
    await click("キャンセル");
    expect(container.querySelector("textarea")?.value).toBe(original);

    await click("Edit test table");
    await changeHeader();
    await click("完了");
    expect(container.querySelector("textarea")?.value).toBe("Before\n\n| Draft | B |\n| --- | --- |\n| 1 | 2 |\n\nAfter");
    expect(container.querySelector(".dirty-indicator")).not.toBeNull();
  });

  test.each(["保存", "名前を付けて保存"])("%s keeps edits made while writing and blocks duplicate saves", async (command) => {
    vi.mocked(open).mockResolvedValue("original.mdpkg");
    vi.mocked(save).mockResolvedValue("copy.mdpkg");
    vi.mocked(tauri.openPackage).mockResolvedValue(documentInfo("Disk"));
    await click("ファイル");
    await click("開く");
    await click("編集");
    await edit("First edit");

    const write = deferred();
    vi.mocked(tauri.savePackage).mockReturnValueOnce(write.promise);
    await click("ファイル");
    await click(command);
    expect(container.textContent).toContain("保存しています…");
    expect(tauri.savePackage).toHaveBeenCalledWith(expect.objectContaining({
      path: command === "保存" ? "original.mdpkg" : "copy.mdpkg",
      files: [expect.objectContaining({ content: "First edit" })],
    }));

    await click("ファイル");
    expect(button("保存").disabled).toBe(true);
    expect(button("名前を付けて保存").disabled).toBe(true);
    await act(async () => {
      button("保存").click();
      saveShortcut();
      saveShortcut();
    });
    expect(tauri.savePackage).toHaveBeenCalledTimes(1);
    await edit("Later edit");
    await act(async () => write.resolve());
    expect(container.querySelector("textarea")?.value).toBe("Later edit");
    expect(container.querySelector(".dirty-indicator")).not.toBeNull();
    expect(document.title).toBe(`*${command === "保存" ? "original.mdpkg" : "copy.mdpkg"} — MaCa Editor`);
    expect(container.textContent).not.toContain("保存しています…");

    await act(async () => saveShortcut());
    expect(tauri.savePackage).toHaveBeenLastCalledWith(expect.objectContaining({
      path: command === "保存" ? "original.mdpkg" : "copy.mdpkg",
      files: [expect.objectContaining({ content: "Later edit" })],
    }));
    expect(container.querySelector(".dirty-indicator")).toBeNull();
  });

  test.each([
    ["Disk full\nWriter detail", "ディスクの空き容量が不足しています。"],
    ["failed to save file: アクセスが拒否されました。 (os error 5)", "詳しくは詳細欄を確認してください。"],
  ])("closing a save error preserves dirty edits and keeps the Japanese summary (%s)", async (detail, summary) => {
    vi.mocked(open).mockResolvedValue("original.mdpkg");
    vi.mocked(tauri.openPackage).mockResolvedValue(documentInfo("Disk"));
    const confirm = vi.spyOn(window, "confirm");
    await click("ファイル");
    await click("開く");
    await click("編集");
    await edit("Unsaved edit");

    vi.mocked(tauri.savePackage).mockRejectedValueOnce(new Error(detail));
    await act(async () => saveShortcut());
    const banner = container.querySelector(".operation-error")!;
    expect(banner.querySelector('[role="alert"]')?.textContent).toBe(`保存に失敗しました。${summary}`);
    expect([...banner.querySelectorAll("button")].map((item) => item.textContent)).toEqual(["エラーを閉じる"]);
    const details = banner.querySelector("details")!;
    expect(details.open).toBe(false);
    act(() => details.querySelector("summary")!.click());
    expect(details.open).toBe(true);
    expect(details.querySelector(".error-detail")?.textContent).toBe(detail);

    await click("エラーを閉じる", banner);
    expect(container.querySelector(".operation-error")).toBeNull();
    expect(container.querySelector(".status-message")?.textContent).toBe(`保存に失敗しました。${summary}`);
    expect(container.querySelector("textarea")?.value).toBe("Unsaved edit");
    expect(container.querySelector(".dirty-indicator")).not.toBeNull();
    expect(confirm).not.toHaveBeenCalled();

    const statusBar = container.querySelector(".status-bar")!;
    await click("エラーの詳細", statusBar);
    const reopened = container.querySelector('[role="dialog"]')!;
    expect(reopened.querySelector("h2")?.textContent).toBe("エラーの詳細");
    expect(reopened.textContent).toContain(`保存に失敗しました。${summary}`);
    expect(reopened.querySelector(".error-detail")?.textContent).toBe(detail);
    await click("閉じる", reopened);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector(".operation-error")).toBeNull();

    await act(async () => saveShortcut());
    expect(statusBar.querySelector(".status-error-details")).toBeNull();
    expect(container.querySelector(".dirty-indicator")).toBeNull();
    expect(tauri.savePackage).toHaveBeenLastCalledWith(expect.objectContaining({
      files: [expect.objectContaining({ content: "Unsaved edit" })],
    }));
  });

  test("keeps a save error through unrelated edits and clears it after a successful retry", async () => {
    vi.mocked(open).mockResolvedValue("original.mdpkg");
    vi.mocked(tauri.openPackage).mockResolvedValue(documentInfo("Disk"));
    await click("ファイル");
    await click("開く");
    await click("編集");
    await edit("First edit");

    vi.mocked(tauri.savePackage).mockRejectedValueOnce("Permission denied");
    await act(async () => saveShortcut());
    await edit("Later edit");
    expect(container.querySelector(".operation-error")?.textContent).toContain("保存に失敗しました。アクセス権限がありません。");
    await click("ファイル");
    await click("フォルダを追加...");
    const dialog = container.querySelector(".about-dialog")!;
    const input = dialog.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "notes");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("フォルダを追加", dialog);
    expect(container.querySelector(".status-message")?.textContent).toContain("notes を追加しました");
    expect(container.querySelector(".operation-error")?.textContent).toContain("保存に失敗しました。アクセス権限がありません。");

    await act(async () => saveShortcut());
    expect(container.querySelector(".operation-error")).toBeNull();
    expect(container.querySelector(".status-message")?.textContent).toBe("original.mdpkg を保存しました");
    expect(container.querySelector(".dirty-indicator")).toBeNull();
  });

  test("exports local edits and reloads the folder only after confirmation", async () => {
    vi.mocked(open).mockResolvedValue(folderPath);
    vi.mocked(save).mockResolvedValue("backup");
    vi.mocked(tauri.openFolder).mockResolvedValue(documentInfo("Original"));
    await click("ファイル");
    await click("フォルダを開く...");
    await click("編集");

    const read = deferred();
    const external = documentInfo("External edit");
    vi.mocked(tauri.openFolder)
      .mockResolvedValue(external)
      .mockReturnValueOnce(read.promise.then(() => external));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await act(async () => {
      folderChanged(folderPath);
      await vi.advanceTimersByTimeAsync(300);
    });
    await edit("Local edit");
    await act(async () => {
      read.resolve();
      await vi.advanceTimersByTimeAsync(5_000);
    });
    const banner = container.querySelector(".folder-conflict")!;
    expect(banner.textContent).toContain("このフォルダへの保存を停止しています");
    await click("ファイル");
    expect(button("保存").disabled).toBe(true);
    await act(async () => saveShortcut());
    expect(tauri.saveFolder).not.toHaveBeenCalled();
    await click("ファイル");

    const exportError = "failed to save file: アクセスが拒否されました。 (os error 5)";
    vi.mocked(tauri.exportPackage).mockRejectedValueOnce(exportError);
    await click("パッケージに書き出し...", banner);
    expect(container.querySelector('.operation-error [role="alert"]')?.textContent)
      .toBe("パッケージの書き出しに失敗しました。詳しくは詳細欄を確認してください。");
    expect(container.querySelector(".operation-error .error-detail")?.textContent).toBe(exportError);
    expect(container.querySelector("textarea")?.value).toBe("Local edit");
    expect(container.querySelector(".folder-conflict")).toBe(banner);

    await click("パッケージに書き出し...", banner);
    expect(container.querySelector(".operation-error")).toBeNull();
    expect(tauri.exportPackage).toHaveBeenCalledWith(expect.objectContaining({
      path: "backup.mdpkg",
      files: [expect.objectContaining({ content: "Local edit" })],
    }));
    expect(container.querySelector("textarea")?.value).toBe("Local edit");
    expect(container.querySelector(".dirty-indicator")).not.toBeNull();

    await click("フォルダを再読込...", banner);
    expect(container.querySelector(".about-dialog")?.textContent).toContain("未保存の変更を破棄して");
    await click("キャンセル", container.querySelector(".about-dialog")!);
    expect(tauri.openFolder).toHaveBeenCalledTimes(2);
    expect(container.querySelector("textarea")?.value).toBe("Local edit");
    expect(container.querySelector(".folder-conflict")).not.toBeNull();

    await click("フォルダを再読込...", banner);
    await click("破棄して続行", container.querySelector(".about-dialog")!);
    expect(tauri.openFolder).toHaveBeenCalledTimes(3);
    expect(tauri.openFolder).toHaveBeenLastCalledWith(folderPath);
    expect(container.querySelector(".document-area")?.textContent).toContain("External edit");
    expect(container.querySelector(".dirty-indicator")).toBeNull();
    expect(container.querySelector(".folder-conflict")).toBeNull();
    await click("ファイル");
    expect(button("保存").disabled).toBe(false);
  });
});
