import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MarkdownTableEditor } from "./MarkdownTableEditor";
import { parseMarkdownTable } from "../lib/markdownTable";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => { document.body.innerHTML = ""; });

function finish(container: HTMLElement) {
  const done = [...container.querySelectorAll("button")].find((button) => button.textContent === "完了")!;
  act(() => done.click());
}

describe("MarkdownTableEditor", () => {
  test("inserts at boundaries, preserves existing cells and alignment, focuses new cells, and undoes", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onDone = vi.fn();
    const source = "| A | B |\n| --- | ---: |\n| 1 | 2 |\n| 3 | 4 |";
    act(() => root.render(<MarkdownTableEditor source={source} onDone={onDone} onCancel={vi.fn()} />));
    const click = (label: string) => act(() => (container.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement).click());
    const current = () => {
      finish(container);
      return parseMarkdownTable(onDone.mock.lastCall![0]);
    };
    click("2 列目に列を挿入");
    expect(onDone).not.toHaveBeenCalled();
    expect(current()).toEqual({ headers: ["A", "列 3", "B"], aligns: ["left", "left", "right"], rows: [["1", "", "2"], ["3", "", "4"]] });
    expect(document.activeElement?.getAttribute("aria-label")).toBe("2 列目の見出し");
    click("2 行目に行を挿入");
    expect(current().rows).toEqual([["1", "", "2"], ["", "", ""], ["3", "", "4"]]);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("2 行目、1 列目");
    act(() => container.querySelector("textarea")!.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true })));
    expect(current().rows).toHaveLength(2);
    act(() => (container.querySelector(".markdown-table-toolbar button") as HTMLButtonElement).click());
    finish(container);
    expect(onDone).toHaveBeenLastCalledWith(source);
    click("1 行目に行を挿入");
    expect(current().rows[0]).toEqual(["", ""]);
    click("4 行目に行を挿入");
    expect(current().rows[3]).toEqual(["", ""]);
    click("1 列目に列を挿入");
    click("4 列目に列を挿入");
    expect(current().headers).toEqual(["列 3", "A", "B", "列 4"]);
    act(() => root.unmount());
  });

  test.each(["2 列目の見出し", "1 行目、2 列目"])("pastes Markdown at %s with alignment and restores it in one undo", (label) => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const onDone = vi.fn();
    const source = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    act(() => root.render(<MarkdownTableEditor source={source} onDone={onDone} onCancel={vi.fn()} />));
    const paste = (text: string) => {
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: { getData: () => text } });
      act(() => container.querySelector(`textarea[aria-label="${label}"]`)!.dispatchEvent(event));
      return event;
    };
    expect(paste("| X | Y |\n| :---: | ---: |\n| x\\|y | z<br>q |").defaultPrevented).toBe(true);
    expect(onDone).not.toHaveBeenCalled();
    finish(container);
    const table = parseMarkdownTable(onDone.mock.lastCall![0]);
    expect(table.aligns).toEqual(["left", "center", "right"]);
    if (label.endsWith("見出し")) {
      expect(table.headers).toEqual(["A", "X", "Y"]);
      expect(table.rows).toEqual([["1", "x|y", "z\nq"]]);
    } else {
      expect(table.headers).toEqual(["A", "B", "列 3"]);
      expect(table.rows).toEqual([["1", "X", "Y"], ["", "x|y", "z\nq"]]);
    }
    act(() => (container.querySelector(".markdown-table-toolbar button") as HTMLButtonElement).click());
    finish(container);
    expect(onDone).toHaveBeenLastCalledWith(source);
    expect(paste("plain text").defaultPrevented).toBe(false);
    paste("a\tb\nc\td");
    finish(container);
    expect(parseMarkdownTable(onDone.mock.lastCall![0]).aligns).toEqual(["left", "left", "left"]);
    act(() => root.unmount());
  });
  test("edits cells and changes table structure and alignment", () => {
    const onDone = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <MarkdownTableEditor
        source={"| A | B |\n| --- | --- |\n| 1 | 2 |"}
        onDone={onDone}
        onCancel={vi.fn()}
      />,
    ));

    const firstCell = container.querySelector('textarea[aria-label="1 行目、1 列目"]') as HTMLTextAreaElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(firstCell, "updated");
      firstCell.dispatchEvent(new Event("input", { bubbles: true }));
    });
    finish(container);
    expect(onDone).toHaveBeenLastCalledWith(expect.stringContaining("| updated | 2 |"));

    const addRow = container.querySelector('button[aria-label="行を追加"]') as HTMLButtonElement;
    act(() => addRow.click());
    finish(container);
    expect(onDone).toHaveBeenLastCalledWith(expect.stringContaining("|  |  |"));

    const center = container.querySelector('button[aria-label="1 列目を中央寄せ"]') as HTMLButtonElement;
    act(() => center.click());
    finish(container);
    expect(onDone).toHaveBeenLastCalledWith(expect.stringContaining("| :---: | --- |"));
    act(() => root.unmount());
  });
});
