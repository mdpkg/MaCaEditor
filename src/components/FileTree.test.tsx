import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { FileTree } from "./FileTree";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("FileTree", () => {
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
      files: [], dropEffect: "none", effectAllowed: "all",
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
      "Rename", "Delete",
    ]);
    act(() => ([...menu.querySelectorAll("button")]
      .find((button) => button.textContent === "Delete") as HTMLButtonElement).click());
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
      .find((button) => button.textContent === "Rename") as HTMLButtonElement;
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
    act(() => buttons.find((button) => button.textContent === "Move")!.click());
    expect(onMove).toHaveBeenCalledWith("guide.md");
    act(() => file.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    act(() => ([...document.querySelectorAll(".file-tree-context-menu button")] as HTMLButtonElement[])
      .find((button) => button.textContent === "Set as entrypoint")!.click());
    expect(onSetEntrypoint).toHaveBeenCalledWith("guide.md");
    act(() => root.unmount());
  });

  test("offers add actions without changing the current selection", () => {
    const onSelect = vi.fn(); const onAddMarkdown = vi.fn(); const onAddFolder = vi.fn();
    const container = document.createElement("div"); document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<FileTree
      files={[{ path: "docs/guide.md", is_text: true, content: "", base64: null }]}
      selectedPath="docs/guide.md" onSelect={onSelect} onDropImages={vi.fn()}
      canRename={() => false} onRename={vi.fn()} canDelete={() => false} onDelete={vi.fn()}
      onAddMarkdown={onAddMarkdown} onAddFolder={onAddFolder} />));
    const docs = [...container.querySelectorAll(".tree-dir")]
      .find((item) => item.textContent?.trim().endsWith("docs")) as HTMLDivElement;
    act(() => docs.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    expect(onSelect).not.toHaveBeenCalled();
    const buttons = [...document.querySelectorAll(".file-tree-context-menu button")] as HTMLButtonElement[];
    expect(buttons.map((button) => button.textContent)).toEqual(["Add Markdown", "Add Folder"]);
    act(() => buttons[0].click());
    expect(onAddMarkdown).toHaveBeenCalledWith("docs");
    act(() => docs.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    act(() => ([...document.querySelectorAll(".file-tree-context-menu button")] as HTMLButtonElement[])[1].click());
    expect(onAddFolder).toHaveBeenCalledWith("docs");
    act(() => root.unmount());
  });
});
