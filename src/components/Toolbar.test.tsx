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
    const onPrint = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const noop = vi.fn();

    act(() => root.render(
      <Toolbar
        dirty={false}
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
        onInsertTable={noop}
        onAddImage={noop}
        vimMode={false}
        onVimModeChange={onVimModeChange}
        canPrint={true}
      />,
    ));

    const topLevel = Array.from(container.querySelectorAll(".toolbar > .toolbar-menu > button, .toolbar > button"))
      .map((button) => button.textContent);
    expect(topLevel).toEqual(["File", "Insert Diagram", "Insert Table", "Add Image"]);

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
    const vimCheckbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(vimCheckbox.checked).toBe(false);
    expect(vimCheckbox.closest("label")?.previousElementSibling?.textContent).toBe("Add Image");
    act(() => vimCheckbox.click());
    expect(onVimModeChange).toHaveBeenCalledWith(true);

    const diagramButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Insert Diagram") as HTMLButtonElement;
    act(() => diagramButton.click());
    const diagramItems = Array.from(container.querySelectorAll(".toolbar-menu-items button"));
    expect(diagramItems.map((button) => button.textContent)).toEqual(["SVG", "PlantUML", "Mermaid"]);
    act(() => (diagramItems[0] as HTMLButtonElement).click());
    expect(onInsertDrawing).toHaveBeenCalledOnce();

    expect(container.textContent).not.toContain("Rename");
    expect(container.textContent).not.toContain("Delete");
    act(() => root.unmount());
  });
});
