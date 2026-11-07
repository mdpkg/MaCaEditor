import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { open, save } from "@tauri-apps/plugin-dialog";
import App from "./App";
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
  MarkdownPreview: ({ markdown }: { markdown: string }) => <p>{markdown}</p>,
}));
vi.mock("./components/MarkdownEditor", () => ({
  MarkdownEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) =>
    <textarea value={value} onChange={(event) => onChange(event.currentTarget.value)} />,
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
