export type TableAlignment = "left" | "center" | "right";

export interface MarkdownTableData {
  headers: string[];
  aligns: TableAlignment[];
  rows: string[][];
}

export const EMPTY_2X2_MARKDOWN_TABLE = "|  |  |\n| --- | --- |\n|  |  |\n|  |  |";

function splitRow(line: string): string[] {
  const trimmed = line.trim();
  const cells = [""];
  let endsWithDelimiter = false;
  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index];
    endsWithDelimiter = false;
    if (character === "\\" && /[\\|]/.test(trimmed[index + 1] || "")) {
      cells[cells.length - 1] += trimmed[++index];
    } else if (character === "|") {
      cells.push("");
      endsWithDelimiter = true;
    } else {
      cells[cells.length - 1] += character;
    }
  }
  if (trimmed.startsWith("|")) cells.shift();
  if (endsWithDelimiter) cells.pop();
  return cells.map((cell) => cell.trim().replace(/<br\s*\/?\s*>/gi, "\n"));
}

function parseAlignment(value: string): TableAlignment {
  const marker = value.trim();
  if (marker.startsWith(":") && marker.endsWith(":")) return "center";
  if (marker.endsWith(":")) return "right";
  return "left";
}

export function parseMarkdownTable(markdown: string): MarkdownTableData {
  const lines = markdown.trim().split(/\r\n|\r|\n/);
  if (lines.length < 2) throw new Error("A Markdown table needs a header and separator row");
  const headers = splitRow(lines[0]);
  const aligns = splitRow(lines[1]).map(parseAlignment);
  if (headers.length === 0 || aligns.length !== headers.length) {
    throw new Error("Invalid Markdown table columns");
  }
  const rows = lines.slice(2).map(splitRow).map((row) => [
    ...row.slice(0, headers.length),
    ...Array(Math.max(0, headers.length - row.length)).fill(""),
  ]);
  return { headers, aligns, rows };
}

// Detect clipboard tables strictly so ordinary multiline text still falls back to TSV.
export function parseClipboardMarkdownTable(value: string): MarkdownTableData | null {
  const lines = value.trim().split(/\r\n|\r|\n/);
  if (lines.length < 2 || !lines[0].includes("|") || !lines[1].includes("|")) return null;
  const headers = splitRow(lines[0]);
  const markers = splitRow(lines[1]);
  if (headers.length !== markers.length || !markers.every((marker) => /^:?-{3,}:?$/.test(marker))) {
    return null;
  }
  return parseMarkdownTable(value);
}

function escapeCell(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>");
}

function alignmentMarker(alignment: TableAlignment): string {
  if (alignment === "center") return ":---:";
  if (alignment === "right") return "---:";
  return "---";
}

export function serializeMarkdownTable(table: MarkdownTableData): string {
  const header = `| ${table.headers.map(escapeCell).join(" | ")} |`;
  const alignments = `| ${table.aligns.map(alignmentMarker).join(" | ")} |`;
  const rows = table.rows.map((row) =>
    `| ${table.headers.map((_, index) => escapeCell(row[index] ?? "")).join(" | ")} |`,
  );
  return [header, alignments, ...rows].join("\n");
}
