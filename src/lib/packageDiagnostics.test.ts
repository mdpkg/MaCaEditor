import { describe, expect, test } from "vitest";
import type { DocumentState } from "./document";
import { diagnosePackage } from "./packageDiagnostics";

function state(overrides: Partial<DocumentState> = {}): DocumentState {
  return {
    path: null,
    origin: { kind: "untitled" },
    originalPaths: [],
    entrypoint: "index.md",
    files: [{ path: "index.md", is_text: true, content: "# Index", base64: null }],
    manifest: { format: "mdpkg", version: "2.0", entrypoint: "index.md" },
    dirty: false,
    ...overrides,
  };
}

describe("diagnosePackage", () => {
  test("reports missing, escaping, and case-mismatched Markdown links", () => {
    const document = state({ files: [
      { path: "index.md", is_text: true, content: [
        "[Missing](missing.md)",
        "[Outside](../outside.md)",
        "![Case](images/photo.png)",
      ].join("\n"), base64: null },
      { path: "images/Photo.png", is_text: false, content: null, base64: "AAAA" },
    ] });
    expect(diagnosePackage(document).map((item) => item.code)).toEqual([
      "missing-link", "outside-package-link", "link-case-mismatch",
    ]);
  });

  test("reports missing resource pairs and unreferenced files", () => {
    const document = state({
      files: [
        { path: "index.md", is_text: true, content: "# Index", base64: null },
        { path: "diagrams/a.puml", is_text: true, content: "@startuml", base64: null },
        { path: "unused.txt", is_text: true, content: "unused", base64: null },
      ],
      manifest: { format: "mdpkg", version: "2.0", entrypoint: "index.md", resources: [
        { type: "plantuml", source: "diagrams/a.puml", rendered: "diagrams/a.svg" },
      ] },
    });
    expect(diagnosePackage(document).map((item) => `${item.code}:${item.target ?? item.path}`)).toEqual([
      "missing-resource:diagrams/a.svg",
      "unreferenced-file:unused.txt",
    ]);
  });

  test("reports unsafe, Unicode-colliding, and non-UTF-8 Markdown paths", () => {
    const document = state({ files: [
      { path: "index.md", is_text: true, content: "# Index", base64: null },
      { path: "../bad.txt", is_text: true, content: "bad", base64: null },
      { path: "é.md", is_text: true, content: "one", base64: null },
      { path: "é.md", is_text: true, content: "two", base64: null },
      { path: "binary.md", is_text: false, content: null, base64: "//4=" },
    ] });
    expect(diagnosePackage(document).map((item) => item.code)).toContain("unsafe-path");
    expect(diagnosePackage(document).map((item) => item.code)).toContain("path-collision");
    expect(diagnosePackage(document).map((item) => item.code)).toContain("invalid-markdown-encoding");
  });

  test("reports rendered resources marked stale after source edits", () => {
    const document = state({ staleResources: ["diagrams/a.svg"] });
    expect(diagnosePackage(document)).toContainEqual(expect.objectContaining({
      code: "stale-resource", target: "diagrams/a.svg",
    }));
  });
});
