import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MarkdownTableEditor } from "./MarkdownTableEditor";
import { parseMarkdownTable } from "../lib/markdownTable";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => { document.body.innerHTML = ""; });

describe("MarkdownTableEditor", () => {
  test("inserts at boundaries, preserves existing cells and alignment, focuses new cells, and undoes", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onChange = vi.fn();
    const source = "| A | B |\n| --- | ---: |\n| 1 | 2 |\n| 3 | 4 |";
    act(() => root.render(<MarkdownTableEditor source={source} onChange={onChange} onDone={vi.fn()} />));
    const click = (label: string) => act(() => (container.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement).click());
    const current = () => parseMarkdownTable(onChange.mock.lastCall![0]);
    click("2 列目に列を挿入");
    expect(current()).toEqual({ headers: ["A", "列 3", "B"], aligns: ["left", "left", "right"], rows: [["1", "", "2"], ["3", "", "4"]] });
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Header column 2");
    click("2 行目に行を挿入");
    expect(current().rows).toEqual([["1", "", "2"], ["", "", ""], ["3", "", "4"]]);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Row 2, column 1");
    act(() => container.querySelector("textarea")!.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true })));
    expect(current().rows).toHaveLength(2);
    act(() => (container.querySelector(".markdown-table-toolbar button") as HTMLButtonElement).click());
    expect(onChange).toHaveBeenLastCalledWith(source);
    click("1 行目に行を挿入");
    expect(current().rows[0]).toEqual(["", ""]);
    click("4 行目に行を挿入");
    expect(current().rows[3]).toEqual(["", ""]);
    click("1 列目に列を挿入");
    click("4 列目に列を挿入");
    expect(current().headers).toEqual(["列 3", "A", "B", "列 4"]);
    act(() => root.unmount());
  });

  test.each(["Header column 2", "Row 1, column 2"])("pastes Markdown at %s with alignment and restores it in one undo", (label) => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const onChange = vi.fn();
    const source = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    act(() => root.render(<MarkdownTableEditor source={source} onChange={onChange} onDone={vi.fn()} />));
    const paste = (text: string) => {
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: { getData: () => text } });
      act(() => container.querySelector(`textarea[aria-label="${label}"]`)!.dispatchEvent(event));
      return event;
    };
    expect(paste("| X | Y |\n| :---: | ---: |\n| x\\|y | z<br>q |").defaultPrevented).toBe(true);
    const table = parseMarkdownTable(onChange.mock.lastCall![0]);
    expect(table.aligns).toEqual(["left", "center", "right"]);
    if (label.startsWith("Header")) {
      expect(table.headers).toEqual(["A", "X", "Y"]);
      expect(table.rows).toEqual([["1", "x|y", "z\nq"]]);
    } else {
      expect(table.headers).toEqual(["A", "B", "列 3"]);
      expect(table.rows).toEqual([["1", "X", "Y"], ["", "x|y", "z\nq"]]);
    }
    act(() => (container.querySelector(".markdown-table-toolbar button") as HTMLButtonElement).click());
    expect(onChange).toHaveBeenLastCalledWith(source);
    expect(paste("plain text").defaultPrevented).toBe(false);
    paste("a\tb\nc\td");
    expect(parseMarkdownTable(onChange.mock.lastCall![0]).aligns).toEqual(["left", "left", "left"]);
    act(() => root.unmount());
  });
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
