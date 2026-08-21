import { describe, expect, test } from "vitest";
import { EMPTY_2X2_MARKDOWN_TABLE, parseMarkdownTable, serializeMarkdownTable } from "./markdownTable";

describe("Markdown table model", () => {
  test("provides an empty two-column, two-row table with a header", () => {
    expect(EMPTY_2X2_MARKDOWN_TABLE).toBe("|  |  |\n| --- | --- |\n|  |  |\n|  |  |");
  });
  test("parses headers, rows, escaped pipes, and alignment", () => {
    const table = parseMarkdownTable([
      "| Name | Description | Value |",
      "| :--- | :---: | ---: |",
      "| A | left \\| right | 10 |",
    ].join("\n"));

    expect(table.headers).toEqual(["Name", "Description", "Value"]);
    expect(table.aligns).toEqual(["left", "center", "right"]);
    expect(table.rows).toEqual([["A", "left | right", "10"]]);
  });

  test("serializes a GitHub Flavored Markdown table", () => {
    expect(serializeMarkdownTable({
      headers: ["Name", "Notes"],
      aligns: ["left", "center"],
      rows: [["A", "one | two"], ["B", "line 1\nline 2"]],
    })).toBe([
      "| Name | Notes |",
      "| --- | :---: |",
      "| A | one \\| two |",
      "| B | line 1<br>line 2 |",
    ].join("\n"));
  });
});
