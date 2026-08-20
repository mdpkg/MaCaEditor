import { describe, expect, test } from "vitest";
import { buildFileTree } from "./fileTree";

describe("buildFileTree", () => {
  test("builds nested tree", () => {
    const tree = buildFileTree([
      "README.md",
      "manifest.json",
      "diagrams/architecture.puml",
      "diagrams/architecture.svg",
      "images/screenshot.png",
    ]);
    const names = tree.map((n) => n.name);
    expect(names).toContain("README.md");
    expect(names).toContain("manifest.json");
    expect(names).toContain("diagrams");
    expect(names).toContain("images");

    const diagrams = tree.find((n) => n.name === "diagrams");
    expect(diagrams?.children.map((c) => c.name)).toEqual([
      "architecture.puml",
      "architecture.svg",
    ]);
  });

  test("sorts directories before files", () => {
    const tree = buildFileTree(["README.md", "diagrams/a.puml"]);
    expect(tree[0].name).toBe("diagrams");
    expect(tree[1].name).toBe("README.md");
  });

  test("includes requested empty directories", () => {
    const tree = buildFileTree(["README.md"], ["images"]);
    const images = tree.find((node) => node.path === "images");
    expect(images).toMatchObject({ name: "images", isDir: true, children: [] });
  });
});
