import { describe, expect, test } from "vitest";
import { normalizeDiagramSource } from "./aiDiagram";

describe("normalizeDiagramSource", () => {
  test("keeps plain PlantUML", () => expect(normalizeDiagramSource("@startuml\nA->B\n@enduml", "plantuml")).toBe("@startuml\nA->B\n@enduml"));
  test.each(["plantuml", "puml"])("removes a complete %s fence", (lang) => expect(normalizeDiagramSource(`\`\`\`${lang}\n@startuml\nA->B\n@enduml\n\`\`\``, "plantuml")).toBe("@startuml\nA->B\n@enduml"));
  test("removes a complete Mermaid fence", () => expect(normalizeDiagramSource("\`\`\`mermaid\nflowchart TD\nA-->B\n\`\`\`", "mermaid")).toBe("flowchart TD\nA-->B"));
  test("does not repair explanatory text", () => expect(normalizeDiagramSource("Here is the diagram:\n@startuml\n@enduml", "plantuml")).toContain("Here is"));
});
