import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { FileTree } from "./FileTree";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("FileTree", () => {
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

    expect(onSelect).toHaveBeenCalledWith("images/photo.png");
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
});
