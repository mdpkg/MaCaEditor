export type DiagramFormat = "plantuml" | "mermaid";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function restoreCollapsedPlantUml(source: string): string {
  if (!source.includes("@startuml") || !source.includes("@enduml")) return source;
  let restored = source
    .replace(/@startuml\s*/i, "@startuml\n")
    .replace(/(?<!^)(?<!\n)(?=(?:actor|participant|database|entity|boundary|control|collections|queue|component|node|cloud|frame|folder|package|rectangle|storage)\s)/gim, "\n")
    .replace(/(?<!^)(?<!\n)(?=(?:alt|else|elseif|end)\b)/gim, "\n")
    .replace(/\s*@enduml\s*$/i, "\n@enduml");

  const aliases = new Set<string>();
  for (const line of restored.split("\n")) {
    const declaration = line.match(/^\s*(?:actor|participant|database|entity|boundary|control|collections|queue|component|node|cloud|frame|folder|package|rectangle|storage)\s+(?:"[^"]+"\s+as\s+)?([A-Za-z_][\w.]*)/i);
    if (declaration) aliases.add(declaration[1]);
  }
  for (const alias of aliases) {
    const arrowStart = new RegExp(`(?<!^)(?<!\\n)(?=${escapeRegExp(alias)}\\s+(?:<?[-.ox]+[<>]?))`, "gm");
    restored = restored.replace(arrowStart, "\n");
  }
  return restored.replace(/[ \t]+$/gm, "").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Phase 4 edit で必要な、既存図を保護するための追加 normalization。 */
export function normalizeEditedDiagramSource(value: string, format: DiagramFormat): string {
  let normalized = value.trim();
  if ((normalized.startsWith('"') && normalized.endsWith('"')) ||
      (normalized.startsWith("{") && normalized.endsWith("}"))) {
    try {
      const parsed: unknown = JSON.parse(normalized);
      if (typeof parsed === "string") normalized = parsed;
      else if (typeof parsed === "object" && parsed !== null) {
        const candidate = parsed as { format?: unknown; source?: unknown };
        if (typeof candidate.source === "string" &&
            (candidate.format === undefined || candidate.format === format)) {
          normalized = candidate.source;
        }
      }
    } catch {
      // JSON 全体として解釈できない応答は、過剰に修復せず renderer へ渡す。
    }
  }
  normalized = normalized.replace(/\r\n?|\u2028|\u2029/g, "\n").trim();
  const language = format === "plantuml" ? "(?:plantuml|puml)" : "mermaid";
  const fence = "`".repeat(3);
  const expectedFence = normalized.match(new RegExp(`^${fence}(?:${language})?[ \\t]*(?:\\n)?([\\s\\S]*?)${fence}$`, "i"));
  const mislabeledFence = normalized.match(new RegExp(`^${fence}[A-Za-z0-9_-]+[ \\t]*\\n([\\s\\S]*?)${fence}$`, "i"));
  const match = mislabeledFence ?? expectedFence;
  normalized = (match ? match[1] : normalized).trim();

  if (!normalized.includes("\n") && /\\[rn]/.test(normalized)) {
    const expanded = normalized.replace(/\\r\\n|\\n|\\r/g, "\n");
    const isCompletePlantUml = /^@startuml(?:\n|\s)/i.test(expanded) && /(?:\n|\s)@enduml$/i.test(expanded);
    const hasMermaidHeader = /^(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|gitGraph|mindmap|timeline|quadrantChart|requirementDiagram|C4\w*)\b/i.test(expanded);
    if ((format === "plantuml" && isCompletePlantUml) || (format === "mermaid" && hasMermaidHeader)) {
      normalized = expanded;
    }
  }
  return (format === "plantuml" ? restoreCollapsedPlantUml(normalized) : normalized).trim();
}
