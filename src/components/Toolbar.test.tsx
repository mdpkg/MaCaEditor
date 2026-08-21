import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { Toolbar } from "./Toolbar";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Toolbar asset deletion", () => {
  test("enables Delete for a deletable selected asset", () => {
    const onDelete = vi.fn();
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
        onInsertDrawing={noop}
        onInsertPlantUml={noop}
        onAddImage={noop}
        canRename={true}
        onRename={noop}
        canDelete={true}
        onDelete={onDelete}
      />,
    ));
    const button = Array.from(container.querySelectorAll("button"))
      .find((candidate) => candidate.textContent === "Delete") as HTMLButtonElement;

    act(() => button.click());

    expect(button.disabled).toBe(false);
    expect(onDelete).toHaveBeenCalledOnce();
    act(() => root.unmount());
  });
});
