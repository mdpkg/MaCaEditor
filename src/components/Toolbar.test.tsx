import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { Toolbar } from "./Toolbar";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Toolbar menus", () => {
  test("groups file and diagram commands and removes rename and delete", () => {
    const onInsertDrawing = vi.fn();
    const onVimModeChange = vi.fn();
    const onShowTocChange = vi.fn();
    const onRspressModeChange = vi.fn();
    const onPrint = vi.fn();
    const onToggleFileList = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const noop = vi.fn();

    act(() => root.render(
      <Toolbar
        dirty={false}
        fileListOpen={true}
        onToggleFileList={onToggleFileList}
        hasDocument={true}
        onOpen={noop}
        onSave={noop}
        onSaveAs={noop}
        onPrint={onPrint}
        onNew={noop}
        onImport={noop}
        onExport={noop}
        onInsertDrawing={onInsertDrawing}
        onInsertPlantUml={noop}
        onInsertMermaid={noop}
        onInsertMathJax={noop}
        onInsertTable={noop}
        onAddImage={noop}
        showToc={false}
        onShowTocChange={onShowTocChange}
        rspressMode={false}
        onRspressModeChange={onRspressModeChange}
        vimMode={false}
        onVimModeChange={onVimModeChange}
        canPrint={true}
      />,
    ));

    const topLevel = Array.from(container.querySelectorAll(".toolbar > .toolbar-menu > button, .toolbar > button"))
      .map((button) => button.textContent);
    expect(topLevel).toEqual(["☰", "File", "Insert Diagram", "Insert Table", "Add Image"]);

    const fileListButton = container.querySelector(".toolbar-file-list-toggle") as HTMLButtonElement;
    expect(fileListButton.getAttribute("aria-pressed")).toBe("true");
    act(() => fileListButton.click());
    expect(onToggleFileList).toHaveBeenCalledOnce();

    const fileButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "File") as HTMLButtonElement;
    act(() => fileButton.click());
    expect(Array.from(container.querySelectorAll(".toolbar-menu-items button")).map((button) => button.textContent))
      .toEqual(["New", "Open", "Save", "Save As", "Print", "Import Folder", "Export Folder"]);
    const printButton = Array.from(container.querySelectorAll(".toolbar-menu-items button"))
      .find((button) => button.textContent === "Print") as HTMLButtonElement;
    act(() => printButton.click());
    expect(onPrint).toHaveBeenCalledOnce();
    act(() => fileButton.click());
    expect(container.querySelector('[role="separator"]')).not.toBeNull();
    expect(container.querySelector('.toolbar-menu-items input[type="checkbox"]')).toBeNull();
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    const tocCheckbox = checkboxes[0] as HTMLInputElement;
    const rspressCheckbox = checkboxes[1] as HTMLInputElement;
    const vimCheckbox = checkboxes[2] as HTMLInputElement;
    expect(tocCheckbox.closest("label")?.textContent).toContain("TOC");
    expect(tocCheckbox.closest("label")?.nextElementSibling?.textContent).toContain("Rspress");
    expect(rspressCheckbox.closest("label")?.nextElementSibling?.textContent).toContain("Vim mode");
    act(() => tocCheckbox.click());
    expect(onShowTocChange).toHaveBeenCalledWith(true);
    expect(vimCheckbox.checked).toBe(false);
    act(() => rspressCheckbox.click());
    expect(onRspressModeChange).toHaveBeenCalledWith(true);
    act(() => vimCheckbox.click());
    expect(onVimModeChange).toHaveBeenCalledWith(true);

    const diagramButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Insert Diagram") as HTMLButtonElement;
    act(() => diagramButton.click());
    const diagramItems = Array.from(container.querySelectorAll(".toolbar-menu-items button"));
    expect(diagramItems.map((button) => button.textContent)).toEqual(["SVG", "PlantUML", "Mermaid", "MathJax"]);
    act(() => (diagramItems[0] as HTMLButtonElement).click());
    expect(onInsertDrawing).toHaveBeenCalledOnce();

    expect(container.textContent).not.toContain("Rename");
    expect(container.textContent).not.toContain("Delete");
    act(() => root.unmount());
  });
});
