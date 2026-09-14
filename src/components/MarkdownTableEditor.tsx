import { useLayoutEffect, useRef, useState } from "react";
import {
  parseMarkdownTable,
  parseClipboardMarkdownTable,
  serializeMarkdownTable,
  type MarkdownTableData,
  type TableAlignment,
} from "../lib/markdownTable";

interface Props {
  source: string;
  onChange: (markdown: string) => void;
  onDone: () => void;
}

function clone(table: MarkdownTableData): MarkdownTableData {
  return {
    headers: [...table.headers],
    aligns: [...table.aligns],
    rows: table.rows.map((row) => [...row]),
  };
}

export function MarkdownTableEditor({ source, onChange, onDone }: Props) {
  const [table, setTable] = useState(() => parseMarkdownTable(source));
  const [status, setStatus] = useState("");
  const undoStack = useRef<MarkdownTableData[]>([]);
  const editorRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (pendingFocus.current) {
      editorRef.current?.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${pendingFocus.current}"]`)?.focus();
      pendingFocus.current = null;
    }
  }, [table]);

  const commit = (next: MarkdownTableData, message = "") => {
    undoStack.current.push(clone(table));
    if (undoStack.current.length > 100) undoStack.current.shift();
    setTable(next);
    setStatus(message);
    onChange(serializeMarkdownTable(next));
  };

  const updateCell = (row: number, column: number, value: string) => {
    const next = clone(table);
    if (row < 0) next.headers[column] = value;
    else next.rows[row][column] = value;
    commit(next);
  };

  const pasteTable = (event: React.ClipboardEvent, row: number, column: number) => {
    const text = event.clipboardData.getData("text/plain");
    if (!text.includes("\t") && !/[\r\n]/.test(text)) return;
    event.preventDefault();
    const markdownTable = parseClipboardMarkdownTable(text);
    const values = markdownTable ? [markdownTable.headers, ...markdownTable.rows] : text.replace(/\r\n?/g, "\n").replace(/\n$/, "")
      .split("\n").map((line) => line.split("\t"));
    const next = clone(table);
    const neededColumns = column + Math.max(...values.map((line) => line.length));
    while (next.headers.length < neededColumns) {
      next.headers.push(`列 ${next.headers.length + 1}`);
      next.aligns.push("left");
      next.rows.forEach((current) => current.push(""));
    }
    markdownTable?.aligns.forEach((alignment, offset) => {
      next.aligns[column + offset] = alignment;
    });
    const firstDataRow = row < 0 ? 0 : row;
    const dataCount = row < 0 ? values.length - 1 : values.length;
    while (next.rows.length < firstDataRow + dataCount) {
      next.rows.push(Array(next.headers.length).fill(""));
    }
    values.forEach((pastedRow, rowOffset) => {
      const header = row < 0 && rowOffset === 0;
      const targetRow = row < 0 ? rowOffset - 1 : row + rowOffset;
      pastedRow.forEach((value, columnOffset) => {
        if (header) next.headers[column + columnOffset] = value;
        else next.rows[targetRow][column + columnOffset] = value;
      });
    });
    commit(next, markdownTable ? "Markdown テーブルを貼り付けました" : "TSV を貼り付けました");
  };

  const insertRow = (row: number) => {
    const next = clone(table);
    next.rows.splice(row, 0, Array(next.headers.length).fill(""));
    pendingFocus.current = `Row ${row + 1}, column 1`;
    commit(next, `${row + 1} 行目に行を挿入しました`);
  };

  const insertColumn = (column: number) => {
    const next = clone(table);
    next.headers.splice(column, 0, `列 ${next.headers.length + 1}`);
    next.aligns.splice(column, 0, "left");
    next.rows.forEach((row) => row.splice(column, 0, ""));
    pendingFocus.current = `Header column ${column + 1}`;
    commit(next, `${column + 1} 列目に列を挿入しました`);
  };

  const insertButton = (axis: "row" | "column", index: number, end = false) => {
    const label = `${index + 1} ${axis === "column" ? "列目に列" : "行目に行"}を挿入`;
    return <button type="button" className={`table-insert-button${end ? " table-insert-column-end" : ""}`}
      aria-label={label} title={label}
      onClick={() => axis === "column" ? insertColumn(index) : insertRow(index)}>+</button>;
  };

  const setAlignment = (column: number, alignment: TableAlignment) => {
    const next = clone(table);
    next.aligns[column] = alignment;
    commit(next);
  };

  const deleteColumn = (column: number) => {
    if (table.headers.length <= 1) {
      setStatus("最後の1列は削除できません");
      return;
    }
    const next = clone(table);
    next.headers.splice(column, 1);
    next.aligns.splice(column, 1);
    next.rows.forEach((row) => row.splice(column, 1));
    commit(next, "列を削除しました");
  };

  const undo = () => {
    const previous = undoStack.current.pop();
    if (!previous) {
      setStatus("戻せる操作がありません");
      return;
    }
    setTable(previous);
    setStatus("元に戻しました");
    onChange(serializeMarkdownTable(previous));
  };

  return (
    <div
      ref={editorRef}
      className="markdown-table-editor"
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !event.shiftKey) {
          event.preventDefault();
          undo();
        }
      }}
    >
      <div className="markdown-table-toolbar">
        <button type="button" onClick={undo}>元に戻す</button>
        <button type="button" onClick={onDone}>完了</button>
      </div>
      <section className="markdown-table-panel">
        <h2>テーブル編集</h2>
        <p className="markdown-table-help">
          表の上・左の境目にある + で、その位置に列・行を挿入できます。
          TSV または Markdown テーブルを貼り付けると、そのセルを起点に展開します。
          Markdown の区切り行は列の配置に反映します。Ctrl+Z / Cmd+Z で操作を戻せます。
        </p>
        <div className="markdown-table-wrap">
          <table>
            <thead>
              <tr>
                <th className="table-row-actions" />
                {table.headers.map((_, column) => (
                  <th className="table-column-actions" key={`delete-${column}`}>
                    <button type="button" className="danger" onClick={() => deleteColumn(column)}>
                      削除
                    </button>
                    {insertButton("column", column)}
                    {column === table.headers.length - 1 && insertButton("column", table.headers.length, true)}
                  </th>
                ))}
                <th rowSpan={table.rows.length + 3} className="table-add-column-cell">
                  <button
                    type="button"
                    aria-label="列を追加"
                    onClick={() => insertColumn(table.headers.length)}
                  >+</button>
                </th>
              </tr>
              <tr>
                <th />
                {table.aligns.map((alignment, column) => (
                  <th className="table-alignment-actions" key={`align-${column}`}>
                    {(["left", "center", "right"] as const).map((value) => (
                      <button
                        type="button"
                        className={alignment === value ? "active" : ""}
                        aria-label={`列 ${column + 1} を${value === "left" ? "左" : value === "center" ? "中央" : "右"}寄せ`}
                        onClick={() => setAlignment(column, value)}
                        key={value}
                      >{value === "left" ? "左" : value === "center" ? "中央" : "右"}</button>
                    ))}
                  </th>
                ))}
              </tr>
              <tr>
                <th className="table-row-actions">見出し</th>
                {table.headers.map((header, column) => (
                  <th key={`header-${column}`} style={{ textAlign: table.aligns[column] }}>
                    <textarea
                      value={header}
                      aria-label={`Header column ${column + 1}`}
                      onChange={(event) => updateCell(-1, column, event.target.value)}
                      onPaste={(event) => pasteTable(event, -1, column)}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`}>
                  <td className="table-row-actions">
                    <button type="button" className="danger" onClick={() => {
                      const next = clone(table);
                      next.rows.splice(rowIndex, 1);
                      if (next.rows.length === 0) next.rows.push(Array(next.headers.length).fill(""));
                      commit(next, "行を削除しました");
                    }}>削除</button>
                    {insertButton("row", rowIndex)}
                  </td>
                  {row.map((value, column) => (
                    <td key={`cell-${rowIndex}-${column}`} style={{ textAlign: table.aligns[column] }}>
                      <textarea
                        value={value}
                        aria-label={`Row ${rowIndex + 1}, column ${column + 1}`}
                        onChange={(event) => updateCell(rowIndex, column, event.target.value)}
                        onPaste={(event) => pasteTable(event, rowIndex, column)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <td className="table-add-row-cell" colSpan={table.headers.length + 1}>
                  <button type="button" aria-label="行を追加" onClick={() => insertRow(table.rows.length)}>+</button>
                  {insertButton("row", table.rows.length)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="markdown-table-status" aria-live="polite">{status}</p>
      </section>
    </div>
  );
}
