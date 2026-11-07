import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { open, save } from "@tauri-apps/plugin-dialog";
import App from "./App";
import * as diagnostics from "./lib/packageDiagnostics";
import * as tauri from "./lib/tauri";
import type { PackageInfo } from "./types";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("./lib/tauri", async (importOriginal) => ({
  ...await importOriginal<typeof tauri>(),
  openPackage: vi.fn(),
  openFolder: vi.fn(),
  savePackage: vi.fn(),
  saveFolder: vi.fn(),
  exportPackage: vi.fn(),
  watchFolder: vi.fn(),
  stopWatchingFolder: vi.fn(),
  onFolderChanged: vi.fn(),
}));
vi.mock("./lib/editorPreferences", () => ({
  loadVimMode: async () => false,
  loadShowToc: async () => false,
  loadRspressMode: async () => false,
  loadDrawingPreferences: async () => ({ gridVisible: true, snap: false, smartGuidesEnabled: true }),
  saveVimMode: vi.fn(),
  saveShowToc: vi.fn(),
  saveRspressMode: vi.fn(),
  saveDrawingPreferences: vi.fn(),
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
  MarkdownEditor: ({ value, onChange, initialCursorPosition, initialScrollTop, onCursorChange, onScrollTopChange }: {
    value: string;
    onChange: (value: string) => void;
    initialCursorPosition?: number;
    initialScrollTop?: number;
    onCursorChange: (position: number) => void;
    onScrollTopChange: (position: number) => void;
  }) => <textarea value={value} data-cursor={initialCursorPosition} data-scroll={initialScrollTop}
    onClick={(event) => onCursorChange(event.currentTarget.selectionStart)}
    onScroll={(event) => onScrollTopChange(event.currentTarget.scrollTop)}
    onChange={(event) => onChange(event.currentTarget.value)} />,
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

  beforeEach(async () => {
    vi.resetAllMocks();
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

  async function edit(value: string) {
    const editor = container.querySelector("textarea");
    if (!editor) throw new Error("Missing editor");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(editor, value);
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function saveShortcut() {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, cancelable: true }));
  }

  test("opens package search only for an unhandled shifted shortcut and returns focus on Escape", async () => {
    vi.mocked(open).mockResolvedValue("original.mdpkg");
    vi.mocked(tauri.openPackage).mockResolvedValue(documentInfo("Disk"));
    await click("File");
    await click("Open");
    await click("Edit");
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

  test("restores cursor and scroll positions separately for each opened file", async () => {
    vi.mocked(open).mockResolvedValue("original.mdpkg");
    const info = documentInfo("0123456789");
    info.files.push({ ...info.files[0], path: "other.md" });
    vi.mocked(tauri.openPackage).mockResolvedValue(info);
    await click("File");
    await click("Open");
    await click("Edit");

    const editor = () => container.querySelector("textarea")!;
    const select = async (path: string) => {
      await act(async () => container.querySelector<HTMLElement>(`[data-path="${path}"]`)!.click());
      await click("Edit");
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
    await click("File");
    await click("Open");
    const diagnose = vi.spyOn(diagnostics, "diagnosePackage");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await click("Edit");
    await edit("[Link](first.md)");
    act(() => vi.advanceTimersByTime(250));
    await edit("[Link](latest.md)");
    act(() => vi.advanceTimersByTime(299));
    expect(diagnose).not.toHaveBeenCalled();
    await click("File");
    await click("Validate Package...");
    expect(container.querySelector(".package-diagnostics-dialog")?.textContent).toContain("latest.md");
    expect(diagnose).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(1));
    expect(diagnose).toHaveBeenCalledTimes(2);
  });

  test("keeps table drafts out of saves and commits only when the user finishes", async () => {
    vi.mocked(open).mockResolvedValue("original.mdpkg");
    const original = "Before\n\n|A|B|\n|---|---|\n|1|2|\n\nAfter";
    vi.mocked(tauri.openPackage).mockResolvedValue(documentInfo(original));
    await click("File");
    await click("Open");
    await click("Edit test table");
    await act(async () => { await import("./components/MarkdownTableEditor"); });
    await click("完了");
    expect(container.querySelector("textarea")?.value).toBe(original);
    expect(container.querySelector(".dirty-indicator")).toBeNull();

    const changeHeader = async () => {
      const cell = container.querySelector<HTMLTextAreaElement>('[aria-label="Header column 1"]')!;
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

  test.each(["Save", "Save As"])("%s keeps edits made while writing and blocks duplicate saves", async (command) => {
    vi.mocked(open).mockResolvedValue("original.mdpkg");
    vi.mocked(save).mockResolvedValue("copy.mdpkg");
    vi.mocked(tauri.openPackage).mockResolvedValue(documentInfo("Disk"));
    await click("File");
    await click("Open");
    await click("Edit");
    await edit("First edit");

    const write = deferred();
    vi.mocked(tauri.savePackage).mockReturnValueOnce(write.promise);
    await click("File");
    await click(command);
    expect(container.textContent).toContain("Saving…");
    expect(tauri.savePackage).toHaveBeenCalledWith(expect.objectContaining({
      path: command === "Save" ? "original.mdpkg" : "copy.mdpkg",
      files: [expect.objectContaining({ content: "First edit" })],
    }));

    await click("File");
    expect(button("Save").disabled).toBe(true);
    expect(button("Save As").disabled).toBe(true);
    await act(async () => {
      button("Save").click();
      saveShortcut();
      saveShortcut();
    });
    expect(tauri.savePackage).toHaveBeenCalledTimes(1);
    await edit("Later edit");
    await act(async () => write.resolve());
    expect(container.querySelector("textarea")?.value).toBe("Later edit");
    expect(container.querySelector(".dirty-indicator")).not.toBeNull();
    expect(container.textContent).not.toContain("Saving…");

    await act(async () => saveShortcut());
    expect(tauri.savePackage).toHaveBeenLastCalledWith(expect.objectContaining({
      path: command === "Save" ? "original.mdpkg" : "copy.mdpkg",
      files: [expect.objectContaining({ content: "Later edit" })],
    }));
    expect(container.querySelector(".dirty-indicator")).toBeNull();
  });

  test("closing a save error preserves dirty edits and keeps the short cause in the status bar", async () => {
    vi.mocked(open).mockResolvedValue("original.mdpkg");
    vi.mocked(tauri.openPackage).mockResolvedValue(documentInfo("Disk"));
    const confirm = vi.spyOn(window, "confirm");
    await click("File");
    await click("Open");
    await click("Edit");
    await edit("Unsaved edit");

    vi.mocked(tauri.savePackage).mockRejectedValueOnce(new Error("Disk full\nWriter detail"));
    await act(async () => saveShortcut());
    const banner = container.querySelector(".operation-error")!;
    expect(banner.querySelector('[role="alert"]')?.textContent).toBe("Save failed: Disk full");
    expect([...banner.querySelectorAll("button")].map((item) => item.textContent)).toEqual(["Close error"]);
    const details = banner.querySelector("details")!;
    expect(details.open).toBe(false);
    act(() => details.querySelector("summary")!.click());
    expect(details.open).toBe(true);
    expect(details.textContent).toContain("Writer detail");

    await click("Close error", banner);
    expect(container.querySelector(".operation-error")).toBeNull();
    expect(container.querySelector(".status-message")?.textContent).toBe("Save failed: Disk full");
    expect(container.querySelector("textarea")?.value).toBe("Unsaved edit");
    expect(container.querySelector(".dirty-indicator")).not.toBeNull();
    expect(confirm).not.toHaveBeenCalled();
  });

  test("keeps a save error through unrelated edits and clears it after a successful retry", async () => {
    vi.mocked(open).mockResolvedValue("original.mdpkg");
    vi.mocked(tauri.openPackage).mockResolvedValue(documentInfo("Disk"));
    await click("File");
    await click("Open");
    await click("Edit");
    await edit("First edit");

    vi.mocked(tauri.savePackage).mockRejectedValueOnce("Permission denied");
    await act(async () => saveShortcut());
    await edit("Later edit");
    expect(container.querySelector(".operation-error")?.textContent).toContain("Save failed: Permission denied");
    vi.spyOn(window, "prompt").mockReturnValueOnce("notes");
    await click("File");
    await click("Add Folder...");
    expect(container.querySelector(".status-message")?.textContent).toContain("Added notes");
    expect(container.querySelector(".operation-error")?.textContent).toContain("Save failed: Permission denied");

    await act(async () => saveShortcut());
    expect(container.querySelector(".operation-error")).toBeNull();
    expect(container.querySelector(".status-message")?.textContent).toBe("Saved original.mdpkg");
    expect(container.querySelector(".dirty-indicator")).toBeNull();
  });

  test("exports local edits and reloads the folder only after confirmation", async () => {
    vi.mocked(open).mockResolvedValue(folderPath);
    vi.mocked(save).mockResolvedValue("backup");
    vi.mocked(tauri.openFolder).mockResolvedValue(documentInfo("Original"));
    await click("File");
    await click("Open Folder...");
    await click("Edit");

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
    expect(banner.textContent).toContain("Saving to this folder is blocked");
    await click("File");
    expect(button("Save").disabled).toBe(true);
    await act(async () => saveShortcut());
    expect(tauri.saveFolder).not.toHaveBeenCalled();
    await click("File");

    await click("Export Package...", banner);
    expect(tauri.exportPackage).toHaveBeenCalledWith(expect.objectContaining({
      path: "backup.mdpkg",
      files: [expect.objectContaining({ content: "Local edit" })],
    }));
    expect(container.querySelector("textarea")?.value).toBe("Local edit");
    expect(container.querySelector(".dirty-indicator")).not.toBeNull();

    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    await click("Reload Folder...", banner);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Discard unsaved changes"));
    expect(tauri.openFolder).toHaveBeenCalledTimes(2);
    expect(container.querySelector("textarea")?.value).toBe("Local edit");
    expect(container.querySelector(".folder-conflict")).not.toBeNull();

    await click("Reload Folder...", banner);
    expect(tauri.openFolder).toHaveBeenCalledTimes(3);
    expect(tauri.openFolder).toHaveBeenLastCalledWith(folderPath);
    expect(container.querySelector(".document-area")?.textContent).toContain("External edit");
    expect(container.querySelector(".dirty-indicator")).toBeNull();
    expect(container.querySelector(".folder-conflict")).toBeNull();
    await click("File");
    expect(button("Save").disabled).toBe(false);
  });
});
