// Parse in an inert document: clipboard HTML must never be inserted into the page.
export function htmlClipboardToMarkdown(html: string): string | null {
  if (!html) return null;
  const document = new DOMParser().parseFromString(html, "text/html");
  document.querySelectorAll("script, style, noscript, template").forEach((node) => node.remove());
  if (!document.querySelector("ul, ol, table")) return null;

  const children = (node: Node): string => Array.from(node.childNodes).map(render).join("");
  const block = (text: string): string => `\n\n${text.trim()}\n\n`;
  const renderList = (list: Element): string => {
    let number = Number(list.getAttribute("start") ?? 1);
    return Array.from(list.children).filter((child) => child.tagName === "LI").map((item) => {
      if (item.hasAttribute("value")) number = Number(item.getAttribute("value"));
      const marker = list.tagName === "OL" ? `${number++}. ` : "- ";
      const content = Array.from(item.childNodes).map((child) =>
        child instanceof Element && /^(UL|OL)$/.test(child.tagName)
          ? `\n${renderList(child)}\n` : render(child),
      ).join("").trim().replace(/\n{3,}/g, "\n\n");
      return marker + content.replace(/\n/g, `\n${" ".repeat(marker.length)}`);
    }).join("\n");
  };
  const renderTable = (table: Element): string => {
    const rows: string[][] = [];
    const occupied = new Map<number, number>();
    for (const row of Array.from(table.querySelectorAll("tr")).filter((row) => row.closest("table") === table)) {
      const cells: string[] = [];
      let column = 0;
      const skipSpans = () => {
        while ((occupied.get(column) ?? 0) > 0) {
          cells[column] = "";
          occupied.set(column, occupied.get(column)! - 1);
          column++;
        }
      };
      for (const cell of Array.from(row.children).filter((cell) => /^(TH|TD)$/.test(cell.tagName))) {
        skipSpans();
        const width = Math.min(1000, Math.max(1, Number(cell.getAttribute("colspan")) || 1));
        const height = Math.max(1, Number(cell.getAttribute("rowspan")) || 1);
        cells[column] = children(cell).trim().replace(/\n+/g, "<br>").replace(/\|/g, "\\|");
        for (let offset = 0; offset < width; offset++) {
          if (offset) cells[column + offset] = "";
          if (height > 1) occupied.set(column + offset, height - 1);
        }
        column += width;
      }
      skipSpans();
      if (cells.length) rows.push(cells);
    }
    if (!rows.length) return "";
    const width = Math.max(...rows.map((row) => row.length));
    const line = (row: string[]) => `| ${Array.from({ length: width }, (_, i) => row[i] ?? "").join(" | ")} |`;
    const caption = table.querySelector("caption");
    return (caption ? block(children(caption)) : "") + block([
      line(rows[0]), line(Array(width).fill("---")), ...rows.slice(1).map(line),
    ].join("\n"));
  };
  function render(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
      return (node.textContent ?? "").replace(/\s+/g, " ").replace(/([\\`*_\[\]<>~])/g, "\\$1");
    }
    if (!(node instanceof Element)) return "";
    const tag = node.tagName;
    if (tag === "UL" || tag === "OL") return block(renderList(node));
    if (tag === "TABLE") return renderTable(node);
    if (tag === "BR") return "\n";
    if (tag === "PRE") return block(`\`\`\`\n${node.textContent ?? ""}\n\`\`\``);
    if (tag === "CODE") {
      const text = node.textContent ?? "";
      const fence = "`".repeat(Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length)) + 1);
      return `${fence} ${text} ${fence}`;
    }
    const text = children(node);
    if (tag === "STRONG" || tag === "B") return `**${text.trim()}**`;
    if (tag === "EM" || tag === "I") return `*${text.trim()}*`;
    if (tag === "DEL" || tag === "S") return `~~${text.trim()}~~`;
    if (tag === "A" && node.getAttribute("href")) {
      const href = node.getAttribute("href")!;
      if (/^\s*(javascript|vbscript|data):/i.test(href)) return text;
      return `[${text}](<${href.replace(/</g, "%3C").replace(/>/g, "%3E")}>)`;
    }
    if (/^H[1-6]$/.test(tag)) return block(`${"#".repeat(Number(tag[1]))} ${text}`);
    if (tag === "BLOCKQUOTE") return block(text.trim().replace(/^/gm, "> "));
    if (/^(P|DIV|SECTION|ARTICLE|HEADER|FOOTER)$/.test(tag)) return block(text);
    return text;
  }
  return children(document.body).replace(/\n[ \t]+\n/g, "\n\n").replace(/\n{3,}/g, "\n\n").trim() || null;
}
