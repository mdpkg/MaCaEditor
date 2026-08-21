import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MarkdownTableEditor } from "./MarkdownTableEditor";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => { document.body.innerHTML = ""; });

describe("MarkdownTableEditor", () => {
  test("edits cells and changes table structure and alignment", () => {
    const onChange = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <MarkdownTableEditor
        source={"| A | B |\n| --- | --- |\n| 1 | 2 |"}
        onChange={onChange}
        onDone={vi.fn()}
      />,
    ));

    const firstCell = container.querySelector('textarea[aria-label="Row 1, column 1"]') as HTMLTextAreaElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(firstCell, "updated");
      firstCell.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining("| updated | 2 |"));

    const addRow = container.querySelector('button[aria-label="行を追加"]') as HTMLButtonElement;
    act(() => addRow.click());
    expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining("|  |  |"));

    const center = container.querySelector('button[aria-label="列 1 を中央寄せ"]') as HTMLButtonElement;
    act(() => center.click());
    expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining("| :---: | --- |"));
    act(() => root.unmount());
  });
});
