import { describe, expect, test } from "vitest";
import { fileTreeIconKind } from "./fileTreeIcons";

describe("fileTreeIconKind", () => {
  test.each([
    ["docs/guide.md", "markdown"],
    ["docs/guide.markdown", "markdown"],
    ["images/photo.png", "image"],
    ["images/vector.svg", "image"],
    ["diagrams/flow.puml", "diagram"],
    ["diagrams/flow.mmd", "diagram"],
    ["diagrams/formula.tex", "diagram"],
    ["diagrams/graph.dot", "diagram"],
    ["diagrams/sketch.draw.json", "diagram"],
    ["attachments/spec.pdf", "other"],
  ] as const)("classifies %s as %s", (path, expected) => {
    expect(fileTreeIconKind(path, {})).toBe(expected);
  });

  test("classifies manifest source and rendered files as diagrams", () => {
    const manifest = { resources: [{
      type: "custom", source: "models/source.txt", rendered: "images/output.svg",
    }] };
    expect(fileTreeIconKind("models/source.txt", manifest)).toBe("diagram");
    expect(fileTreeIconKind("images/output.svg", manifest)).toBe("diagram");
  });

  test("ignores malformed manifest resources", () => {
    expect(fileTreeIconKind("images/output.svg", { resources: [null, "bad"] })).toBe("image");
  });
});
