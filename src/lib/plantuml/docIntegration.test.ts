import { describe, expect, test } from "vitest";
import type { DocumentState } from "../document";
import {
  DEFAULT_PLANTUML_SOURCE,
  addPlantUmlToDocument,
  findPlantUmlResourceBySource,
  savePlantUmlToDocument,
} from "./docIntegration";

function state(): DocumentState {
  return {
    path: "test.mdpkg",
    entrypoint: "README.md",
    files: [{ path: "README.md", is_text: true, content: "# Guide", base64: null }],
    manifest: { resources: [] },
    dirty: false,
  };
}

describe("PlantUML document integration", () => {
  test("adds source, rendered SVG, resource, and Markdown reference", () => {
    const added = addPlantUmlToDocument(
      state(), DEFAULT_PLANTUML_SOURCE, "<svg>first</svg>", "PlantUML",
    );

    expect(added.sourcePath).toBe("diagrams/plantuml-1.puml");
    expect(added.svgPath).toBe("diagrams/plantuml-1.svg");
    expect(added.state.files.find((file) => file.path === added.sourcePath)?.content)
      .toBe(DEFAULT_PLANTUML_SOURCE);
    expect(added.state.files.find((file) => file.path === added.svgPath)?.content)
      .toBe("<svg>first</svg>");
    expect(added.state.manifest.resources).toContainEqual({
      source: added.sourcePath,
      rendered: added.svgPath,
      type: "plantuml",
    });
    expect(added.state.files[0].content).toContain("![PlantUML](diagrams/plantuml-1.svg)");
  });

  test("uses the Markdown cursor and avoids existing names", () => {
    const current = state();
    current.files[0] = { ...current.files[0], content: "beforeafter" };
    current.files.push(
      { path: "diagrams/plantuml-1.puml", is_text: true, content: "", base64: null },
      { path: "diagrams/plantuml-1.svg", is_text: true, content: "", base64: null },
    );

    const added = addPlantUmlToDocument(
      current, DEFAULT_PLANTUML_SOURCE, "<svg />", "PlantUML",
      { markdownPath: "README.md", cursor: 6 },
    );

    expect(added.sourcePath).toBe("diagrams/plantuml-2.puml");
    expect(added.state.files[0].content)
      .toBe("before\n![PlantUML](diagrams/plantuml-2.svg)\nafter");
  });

  test("updates source and rendered SVG together", () => {
    const added = addPlantUmlToDocument(
      state(), DEFAULT_PLANTUML_SOURCE, "<svg>first</svg>", "PlantUML",
    );
    const updated = savePlantUmlToDocument(
      added.state, added.sourcePath, "@startuml\nA -> B\n@enduml", "<svg>second</svg>",
    );

    expect(updated.files.find((file) => file.path === added.sourcePath)?.content)
      .toContain("A -> B");
    expect(updated.files.find((file) => file.path === added.svgPath)?.content)
      .toBe("<svg>second</svg>");
    expect(updated.dirty).toBe(true);
  });

  test("finds only PlantUML resources", () => {
    const manifest = { resources: [
      { source: "a.draw.json", rendered: "a.svg", type: "drawing" },
      { source: "b.puml", rendered: "b.svg", type: "plantuml" },
    ] };
    expect(findPlantUmlResourceBySource(manifest, "b.puml")?.rendered).toBe("b.svg");
    expect(findPlantUmlResourceBySource(manifest, "a.draw.json")).toBeUndefined();
  });
});
