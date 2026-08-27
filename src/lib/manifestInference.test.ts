import { describe, expect, test } from "vitest";
import type { FileInfo } from "../types";
import { inferManifest } from "./manifestInference";

const text = (path: string, content: string): FileInfo => ({ path, is_text: true, content, base64: null });
const binary = (path: string): FileInfo => ({ path, is_text: false, content: null, base64: "AA==" });

describe("inferManifest", () => {
  test("prefers index.md, then README.md, then the first Markdown path", () => {
    expect(inferManifest([text("z.md", ""), text("README.md", ""), text("index.md", "")]).manifest.entrypoint)
      .toBe("index.md");
    expect(inferManifest([text("z.md", ""), text("README.md", "")]).manifest.entrypoint)
      .toBe("README.md");
    expect(inferManifest([text("z.md", ""), text("docs/a.md", "")]).manifest.entrypoint)
      .toBe("docs/a.md");
  });

  test("pairs linked rendered diagrams with same-name source files", () => {
    const result = inferManifest([
      text("index.md", "![Flow](diagrams/flow.svg)\n![Sequence](docs/diagrams/sequence.png)"),
      text("diagrams/flow.puml", "@startuml\n@enduml"),
      text("diagrams/flow.svg", "<svg/ >"),
      text("docs/guide.md", "# Guide"),
      text("docs/diagrams/sequence.mmd", "flowchart LR"),
      binary("docs/diagrams/sequence.png"),
      text("diagrams/unreferenced.dot", "digraph {}"),
      text("diagrams/unreferenced.svg", "<svg/ >"),
    ]);

    expect(result.manifest).toEqual({
      format: "mdpkg",
      version: "2.0",
      entrypoint: "index.md",
      resources: [
        { type: "plantuml", source: "diagrams/flow.puml", rendered: "diagrams/flow.svg" },
        { type: "mermaid", source: "docs/diagrams/sequence.mmd", rendered: "docs/diagrams/sequence.png" },
      ],
    });
  });

  test("reports broken, outside, and ambiguous diagram links", () => {
    const result = inferManifest([
      text("index.md", "[Missing](missing.md)\n[Outside](../secret.md)\n![Diagram](diagram.svg)"),
      text("diagram.puml", ""),
      text("diagram.mmd", ""),
      text("diagram.svg", ""),
    ]);

    expect(result.manifest.resources).toEqual([]);
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("missing.md"),
      expect.stringContaining("../secret.md"),
      expect.stringContaining("diagram.svg"),
    ]));
  });

  test("rejects folders without Markdown", () => {
    expect(() => inferManifest([binary("image.png")])).toThrow("Markdown");
  });
});
