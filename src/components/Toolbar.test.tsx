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
        onNew={noop}
        onImport={noop}
        onExport={noop}
        onInsertDrawing={onInsertDrawing}
        onInsertPlantUml={noop}
        onInsertMermaid={noop}
        onAddImage={noop}
      />,
    ));

    const topLevel = Array.from(container.querySelectorAll(".toolbar > .toolbar-menu > button, .toolbar > button"))
      .map((button) => button.textContent);
    expect(topLevel).toEqual(["File", "Insert Diagram", "Add Image"]);

    const fileButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "File") as HTMLButtonElement;
    act(() => fileButton.click());
    expect(Array.from(container.querySelectorAll(".toolbar-menu-items button")).map((button) => button.textContent))
      .toEqual(["New", "Open", "Save", "Save As", "Import Folder", "Export Folder"]);
    expect(container.querySelector('[role="separator"]')).not.toBeNull();

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
