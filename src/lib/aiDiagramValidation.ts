import type { DiagramFormat } from "./aiDiagram";
import { renderPlantUml } from "./plantuml/renderer";
import { renderMermaid } from "./mermaid/renderer";

export async function validateDiagramSource(
  format: DiagramFormat,
  source: string,
  render: (source: string) => Promise<string> = format === "plantuml" ? renderPlantUml : renderMermaid,
): Promise<string> {
  if (!source.trim()) throw new Error("Diagram source is empty.");
  return render(source);
}
