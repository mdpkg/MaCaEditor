import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { FileTree } from "./FileTree";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("FileTree", () => {
  test("opens a file using the tree keyboard and keeps its context menu on screen", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onSelect = vi.fn();
    const measure = HTMLElement.prototype.getBoundingClientRect;
    const bounds = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.matches(".file-tree-context-menu") ? new DOMRect(0, 0, 140, 110) : measure.call(this);
    });
    try {
      act(() => root.render(<FileTree
        files={[{ path: "docs/guide.md", is_text: true, content: "", base64: null }]}
        selectedPath="docs/guide.md" onSelect={onSelect} onDropImages={vi.fn()}
        canRename={() => true} onRename={vi.fn()} canDelete={() => true} onDelete={vi.fn()} />));
      const tree = container.querySelector('[role="tree"]')!;
      const folder = tree.querySelector<HTMLElement>('[data-path="docs"]')!;
      const file = () => tree.querySelector<HTMLElement>('[data-path="docs/guide.md"]');
      const press = (key: string, shiftKey = false) => act(() => document.activeElement!.dispatchEvent(
        new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true }),
      ));
      expect(tree.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
      act(() => file()!.focus());
      press("ArrowLeft");
      expect(document.activeElement).toBe(folder);
      press("ArrowLeft");
      expect(folder.getAttribute("aria-expanded")).toBe("false");
      expect(file()).toBeNull();
      press("ArrowRight");
      press("ArrowRight");
      expect(document.activeElement).toBe(file());
      press("Enter");
      expect(onSelect).toHaveBeenCalledWith("docs/guide.md");

      press("F10", true);
      expect(document.activeElement?.textContent).toBe("名前を変更");
      press("ArrowDown");
      expect(document.activeElement?.textContent).toBe("削除");
      press("Escape");
      expect(document.activeElement).toBe(file());

      act(() => file()!.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true, cancelable: true, clientX: window.innerWidth - 1, clientY: window.innerHeight - 1,
      })));
      const menu = document.querySelector<HTMLElement>(".file-tree-context-menu")!;
      expect(menu.style.left).toBe(`${window.innerWidth - 140 - 8}px`);
      expect(menu.style.top).toBe(`${window.innerHeight - 110 - 8}px`);
      press("Escape");
      expect(document.querySelector(".file-tree-context-menu")).toBeNull();
      expect(document.activeElement).toBe(file());
    } finally {
      bounds.mockRestore();
      act(() => root.unmount());
    }
  });

  test("shows icons for folders and each file kind", () => {
    const container = document.createElement("div"); document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<FileTree
      files={[
        { path: "docs/guide.md", is_text: true, content: "", base64: null },
        { path: "images/photo.png", is_text: false, content: null, base64: "AA==" },
        { path: "diagrams/flow.puml", is_text: true, content: "", base64: null },
        { path: "diagrams/flow.svg", is_text: true, content: "", base64: null },
        { path: "attachments/spec.pdf", is_text: false, content: null, base64: "AA==" },
      ]}
      manifest={{ resources: [{
        type: "plantuml", source: "diagrams/flow.puml", rendered: "diagrams/flow.svg",
      }] }}
      selectedPath={null} onSelect={vi.fn()} onDropImages={vi.fn()}
      canRename={() => false} onRename={vi.fn()} canDelete={() => false} onDelete={vi.fn()} />));

    const iconKind = (name: string) => [...container.querySelectorAll(".tree-item")]
      .find((item) => item.textContent?.trim().endsWith(name))
      ?.querySelector<HTMLElement>(".tree-item-icon")?.dataset.iconKind;
    expect(iconKind("docs")).toBe("folder");
    expect(iconKind("guide.md")).toBe("markdown");
    expect(iconKind("photo.png")).toBe("image");
    expect(iconKind("flow.puml")).toBe("diagram");
    expect(iconKind("flow.svg")).toBe("diagram");
    expect(iconKind("spec.pdf")).toBe("other");
    act(() => root.unmount());
  });

  test("moves a package file into a folder by drag and drop", () => {
    const onDropPath = vi.fn();
    const container = document.createElement("div"); document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<FileTree
      files={[
        { path: "guide.md", is_text: true, content: "", base64: null },
        { path: "docs/index.md", is_text: true, content: "", base64: null },
        { path: "archive/index.md", is_text: true, content: "", base64: null },
      ]}
      selectedPath="guide.md" onSelect={vi.fn()} onDropImages={vi.fn()}
      canRename={() => false} onRename={vi.fn()} canDelete={() => false} onDelete={vi.fn()}
      onDropPath={onDropPath} />));
    const values = new Map<string, string>();
    const dataTransfer = {
      files: [], dropEffect: "none", effectAllowed: "すべて",
      setData: (type: string, value: string) => values.set(type, value),
      getData: (type: string) => values.get(type) ?? "",
    };
    const guide = [...container.querySelectorAll(".tree-item")]
      .find((item) => item.textContent === "guide.md") as HTMLDivElement;
    const docs = [...container.querySelectorAll(".tree-dir")]
      .find((item) => item.textContent?.trim().endsWith("docs")) as HTMLDivElement;
    const dragStart = new Event("dragstart", { bubbles: true, cancelable: true });
    Object.defineProperty(dragStart, "dataTransfer", { value: dataTransfer });
    act(() => guide.dispatchEvent(dragStart));
    expect(dataTransfer.effectAllowed).toBe("copyMove");
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: dataTransfer });
    act(() => docs.dispatchEvent(drop));
    expect(onDropPath).toHaveBeenCalledWith("guide.md", "docs/guide.md");
    const archive = [...container.querySelectorAll(".tree-dir")]
      .find((item) => item.textContent?.trim().endsWith("archive")) as HTMLDivElement;
    const folderDragStart = new Event("dragstart", { bubbles: true, cancelable: true });
    Object.defineProperty(folderDragStart, "dataTransfer", { value: dataTransfer });
    act(() => docs.dispatchEvent(folderDragStart));
    const folderDrop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(folderDrop, "dataTransfer", { value: dataTransfer });
    act(() => archive.dispatchEvent(folderDrop));
    expect(onDropPath).toHaveBeenCalledWith("docs", "archive/docs");
    act(() => root.unmount());
  });

  test("moves a file with mouse pointer events in Windows Tauri", () => {
    const onDropPath = vi.fn();
    const onSelect = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    vi.stubGlobal("isTauri", true);
    const platform = vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Windows");
    const hitTest = vi.fn();
    const originalHitTest = Object.getOwnPropertyDescriptor(document, "elementFromPoint");
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: hitTest });
    try {
      act(() => root.render(<FileTree
        files={[{ path: "docs/guide.md", is_text: true, content: "", base64: null }]}
        selectedPath={null} onSelect={onSelect} onDropImages={vi.fn()}
        canRename={() => false} onRename={vi.fn()} canDelete={() => false} onDelete={vi.fn()}
        onDropPath={onDropPath} />));
      const guide = container.querySelector<HTMLElement>('[data-path="docs/guide.md"]')!;
      guide.setPointerCapture = vi.fn();
      expect(guide.draggable).toBe(false);
      const pointer = (type: string, clientY: number) => act(() => guide.dispatchEvent(
        new PointerEvent(type, { bubbles: true, pointerId: 1, pointerType: "mouse", clientY }),
      ));
      const click = () => act(() => guide.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })));
      hitTest.mockReturnValue(container.querySelector(".file-tree"));
      pointer("pointerdown", 40);
      pointer("pointerup", 42);
      click();
      expect(onDropPath).not.toHaveBeenCalled();
      expect(onSelect).toHaveBeenCalledWith("docs/guide.md");
      onSelect.mockClear();

      pointer("pointerdown", 40);
      pointer("pointermove", 80);
      expect(container.querySelector(".file-tree-drop-root")).not.toBeNull();
      pointer("pointercancel", 80);
      expect(container.querySelector(".file-tree-drop-root")).toBeNull();
      expect(onDropPath).not.toHaveBeenCalled();

      pointer("pointerdown", 40);
      pointer("pointerup", 80);
      click();
      expect(onDropPath).toHaveBeenCalledTimes(1);
      expect(onDropPath).toHaveBeenCalledWith("docs/guide.md", "guide.md");
      expect(onSelect).not.toHaveBeenCalled();
    } finally {
      act(() => root.unmount());
      if (originalHitTest) Object.defineProperty(document, "elementFromPoint", originalHitTest);
      else Reflect.deleteProperty(document, "elementFromPoint");
      platform.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  test("shows transient empty directories", () => {
    const container = document.createElement("div"); document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<FileTree files={[]} directories={["guides/drafts"]} selectedPath={null}
      onSelect={vi.fn()} onDropImages={vi.fn()} canRename={() => false} onRename={vi.fn()}
      canDelete={() => false} onDelete={vi.fn()} />));
    expect(container.textContent).toContain("guides");
    expect(container.textContent).toContain("drafts");
    act(() => root.unmount());
  });

  test("shows the attachments directory even before a file is added", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <FileTree
        files={[]}
        selectedPath={null}
        onSelect={vi.fn()}
        onDropImages={vi.fn()}
        canRename={() => false}
        onRename={vi.fn()}
        canDelete={() => false}
        onDelete={vi.fn()}
      />,
    ));

    expect([...container.querySelectorAll(".tree-dir")].map((item) => item.textContent?.trim()))
      .toContain("▾ attachments");
    act(() => root.unmount());
  });

  test("opens a Markdown file for editing on double-click", () => {
    const onSelect = vi.fn();
    const onEditMarkdown = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <FileTree
        files={[
          { path: "docs/guide.md", is_text: true, content: "Guide", base64: null },
          { path: "images/photo.png", is_text: false, content: null, base64: "AAAA" },
        ]}
        selectedPath={null}
        onSelect={onSelect}
        onEditMarkdown={onEditMarkdown}
        onDropImages={vi.fn()}
        canRename={() => false}
        onRename={vi.fn()}
        canDelete={() => false}
        onDelete={vi.fn()}
      />,
    ));
    const guide = [...container.querySelectorAll(".tree-item")]
      .find((item) => item.textContent === "guide.md") as HTMLDivElement;
    const image = [...container.querySelectorAll(".tree-item")]
      .find((item) => item.textContent === "photo.png") as HTMLDivElement;

    act(() => guide.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(onSelect).toHaveBeenCalledWith("docs/guide.md");
    expect(onEditMarkdown).toHaveBeenCalledWith("docs/guide.md");

    act(() => image.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(onEditMarkdown).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });

  test("deletes a deletable file from its context menu", () => {
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <FileTree
        files={[
          { path: "README.md", is_text: true, content: "", base64: null },
          { path: "images/photo.png", is_text: false, content: null, base64: "AAAA" },
        ]}
        selectedPath={null}
        onSelect={onSelect}
        onDropImages={vi.fn()}
        canRename={(path) => path.startsWith("images/")}
        onRename={vi.fn()}
        canDelete={(path) => path.startsWith("images/")}
        onDelete={onDelete}
      />,
    ));
    const image = [...container.querySelectorAll(".tree-item")]
      .find((item) => item.textContent === "photo.png") as HTMLDivElement;

    act(() => image.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true, cancelable: true, clientX: 40, clientY: 50,
    })));

    expect(onSelect).not.toHaveBeenCalled();
    const menu = document.querySelector(".file-tree-context-menu") as HTMLDivElement;
    expect(menu.style.left).toBe("40px");
    expect(menu.style.top).toBe("50px");
    expect([...menu.querySelectorAll("button")].map((button) => button.textContent)).toEqual([
      "名前を変更", "削除",
    ]);
    act(() => ([...menu.querySelectorAll("button")]
      .find((button) => button.textContent === "削除") as HTMLButtonElement).click());
    expect(onDelete).toHaveBeenCalledWith("images/photo.png");
    expect(document.querySelector(".file-tree-context-menu")).toBeNull();
    act(() => root.unmount());
  });

  test("does not open a delete menu for a protected file", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <FileTree
        files={[{ path: "README.md", is_text: true, content: "", base64: null }]}
        selectedPath={null}
        onSelect={vi.fn()}
        onDropImages={vi.fn()}
        canRename={() => false}
        onRename={vi.fn()}
        canDelete={() => false}
        onDelete={vi.fn()}
      />,
    ));
    const readme = container.querySelector(".tree-item") as HTMLDivElement;
    act(() => readme.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true, cancelable: true,
    })));
    expect(document.querySelector(".file-tree-context-menu")).toBeNull();
    act(() => root.unmount());
  });

  test("renames a file from its context menu", () => {
    const onRename = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <FileTree
        files={[{ path: "images/photo.png", is_text: false, content: null, base64: "AAAA" }]}
        selectedPath={null}
        onSelect={vi.fn()}
        onDropImages={vi.fn()}
        canRename={() => true}
        onRename={onRename}
        canDelete={() => true}
        onDelete={vi.fn()}
      />,
    ));
    const image = [...container.querySelectorAll(".tree-item")]
      .find((item) => item.textContent === "photo.png") as HTMLDivElement;
    act(() => image.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true, cancelable: true,
    })));
    const rename = [...document.querySelectorAll(".file-tree-context-menu button")]
      .find((button) => button.textContent === "名前を変更") as HTMLButtonElement;
    act(() => rename.click());
    expect(onRename).toHaveBeenCalledWith("images/photo.png");
    expect(document.querySelector(".file-tree-context-menu")).toBeNull();
    act(() => root.unmount());
  });

  test("offers move and entrypoint actions for markdown", () => {
    const onMove = vi.fn(); const onSetEntrypoint = vi.fn();
    const container = document.createElement("div"); document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<FileTree
      files={[{ path: "guide.md", is_text: true, content: "", base64: null }]}
      selectedPath={null} onSelect={vi.fn()} onDropImages={vi.fn()}
      canRename={() => true} onRename={vi.fn()} canDelete={() => true} onDelete={vi.fn()}
      canMove={() => true} onMove={onMove} canSetEntrypoint={(path) => path === "guide.md"}
      onSetEntrypoint={onSetEntrypoint} />));
    const file = [...container.querySelectorAll(".tree-item")]
      .find((item) => item.textContent === "guide.md") as HTMLDivElement;
    act(() => file.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    const buttons = [...document.querySelectorAll(".file-tree-context-menu button")] as HTMLButtonElement[];
    act(() => buttons.find((button) => button.textContent === "移動")!.click());
    expect(onMove).toHaveBeenCalledWith("guide.md");
    act(() => file.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    act(() => ([...document.querySelectorAll(".file-tree-context-menu button")] as HTMLButtonElement[])
      .find((button) => button.textContent === "開始ファイルに設定")!.click());
    expect(onSetEntrypoint).toHaveBeenCalledWith("guide.md");
    act(() => root.unmount());
  });

  test("offers references for a package path", () => {
    const onShowReferences = vi.fn(); const container = document.createElement("div"); document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<FileTree files={[{ path: "guide.md", is_text: true, content: "", base64: null }]}
      selectedPath={null} onSelect={vi.fn()} onDropImages={vi.fn()}
      canRename={() => false} onRename={vi.fn()} canDelete={() => false} onDelete={vi.fn()}
      onShowReferences={onShowReferences} />));
    const guide = [...container.querySelectorAll(".tree-item")]
      .find((item) => item.textContent === "guide.md") as HTMLDivElement;
    act(() => guide
      .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    const button = [...document.querySelectorAll(".file-tree-context-menu button")]
      .find((item) => item.textContent === "参照元を表示") as HTMLButtonElement;
    act(() => button.click());
    expect(onShowReferences).toHaveBeenCalledWith("guide.md");
    act(() => root.unmount());
  });

  test("offers add actions without changing the current selection", () => {
    const onSelect = vi.fn(); const onAdd = vi.fn(() => null);
    const container = document.createElement("div"); document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<FileTree
      files={[{ path: "docs/guide.md", is_text: true, content: "", base64: null }]}
      selectedPath="docs/guide.md" onSelect={onSelect} onDropImages={vi.fn()}
      canRename={() => true} onRename={vi.fn()} canDelete={() => true} onDelete={vi.fn()}
      canMove={() => true} onMove={vi.fn()}
      onAdd={onAdd} />));
    const docs = [...container.querySelectorAll(".tree-dir")]
      .find((item) => item.textContent?.trim().endsWith("docs")) as HTMLDivElement;
    act(() => docs.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    expect(onSelect).not.toHaveBeenCalled();
    const menu = document.querySelector(".file-tree-context-menu") as HTMLDivElement;
    const buttons = [...document.querySelectorAll(".file-tree-context-menu button")] as HTMLButtonElement[];
    expect(buttons.map((button) => button.textContent)).toEqual([
      "名前を変更", "移動", "削除", "Markdown を追加", "フォルダを追加",
    ]);
    expect([...menu.children].map((child) => child.textContent)).toEqual([
      "名前を変更", "移動", "削除", "", "Markdown を追加", "フォルダを追加",
    ]);
    expect(menu.children[3].className).toBe("file-tree-context-menu-divider");
    act(() => buttons[3].click());
    const inline = container.querySelector(".tree-inline-add form")!;
    expect(document.activeElement).toBe(inline.querySelector("input"));
    act(() => inline.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(onAdd).toHaveBeenCalledWith("markdown", "docs", "untitled.md");
    act(() => docs.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    act(() => ([...document.querySelectorAll(".file-tree-context-menu button")] as HTMLButtonElement[])[4].click());
    const folderDraft = container.querySelector(".tree-inline-add input")!;
    act(() => folderDraft.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(container.querySelector(".tree-inline-add")).toBeNull();
    expect(document.activeElement).toBe(docs);
    expect(onAdd).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });
});
