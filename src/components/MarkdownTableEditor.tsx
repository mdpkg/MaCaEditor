import { useRef, useState } from "react";
import {
  parseMarkdownTable,
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

  const pasteTsv = (event: React.ClipboardEvent, row: number, column: number) => {
    const text = event.clipboardData.getData("text/plain");
    if (!text.includes("\t") && !/[\r\n]/.test(text)) return;
    event.preventDefault();
    const values = text.replace(/\r\n?/g, "\n").replace(/\n$/, "")
      .split("\n").map((line) => line.split("\t"));
    const next = clone(table);
    const neededColumns = column + Math.max(...values.map((line) => line.length));
    while (next.headers.length < neededColumns) {
      next.headers.push(`列 ${next.headers.length + 1}`);
      next.aligns.push("left");
      next.rows.forEach((current) => current.push(""));
    }
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
    commit(next, "TSV を貼り付けました");
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
          セルを直接編集できます。TSVを貼り付けると、そのセルを起点に展開します。
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
                  </th>
                ))}
                <th rowSpan={table.rows.length + 3} className="table-add-column-cell">
                  <button
                    type="button"
                    aria-label="列を追加"
                    onClick={() => {
                      const next = clone(table);
                      next.headers.push(`列 ${next.headers.length + 1}`);
                      next.aligns.push("left");
                      next.rows.forEach((row) => row.push(""));
                      commit(next, "列を追加しました");
                    }}
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
                      onPaste={(event) => pasteTsv(event, -1, column)}
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
                  </td>
                  {row.map((value, column) => (
                    <td key={`cell-${rowIndex}-${column}`} style={{ textAlign: table.aligns[column] }}>
                      <textarea
                        value={value}
                        aria-label={`Row ${rowIndex + 1}, column ${column + 1}`}
                        onChange={(event) => updateCell(rowIndex, column, event.target.value)}
                        onPaste={(event) => pasteTsv(event, rowIndex, column)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <td className="table-add-row-cell" colSpan={table.headers.length + 1}>
                  <button type="button" aria-label="行を追加" onClick={() => {
                    const next = clone(table);
                    next.rows.push(Array(next.headers.length).fill(""));
                    commit(next, "行を追加しました");
                  }}>+</button>
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
