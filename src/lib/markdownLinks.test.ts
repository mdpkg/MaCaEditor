import { describe, expect, test } from "vitest";
import { markdownLinks, rewriteMarkdownLinkDestinations } from "./markdownLinks";

describe("markdownLinks", () => {
  test("extracts inline links, images, and reference definitions from an AST", () => {
    const markdown = [
      "[Guide](docs/guide.md \"Guide\")",
      "![Diagram](<diagrams/system (1).svg>)",
      "[Notes][notes]",
      "",
      "[notes]: reference/notes.md \"Notes\"",
    ].join("\n");

    expect(markdownLinks(markdown).map(({ destination, image, kind }) => ({ destination, image, kind })))
      .toEqual([
        { destination: "docs/guide.md", image: false, kind: "inline" },
        { destination: "diagrams/system (1).svg", image: true, kind: "inline" },
        { destination: "reference/notes.md", image: false, kind: "definition" },
      ]);
  });

  test("does not treat links inside code as document links", () => {
    const markdown = "`[inline](ignored.md)`\n\n```md\n[block](ignored.md)\n```";
    expect(markdownLinks(markdown)).toEqual([]);
  });
});

describe("rewriteMarkdownLinkDestinations", () => {
  test("rewrites destinations without changing labels, titles, or reference syntax", () => {
    const markdown = [
      "[Guide](docs/guide.md \"Guide\")",
      "![Diagram](<diagrams/system (1).svg>)",
      "[Notes][notes]",
      "",
      "[notes]: reference/notes.md \"Notes\"",
    ].join("\n");

    expect(rewriteMarkdownLinkDestinations(markdown, (destination) => `moved/${destination}`)).toBe([
      "[Guide](moved/docs/guide.md \"Guide\")",
      "![Diagram](<moved/diagrams/system (1).svg>)",
      "[Notes][notes]",
      "",
      "[notes]: moved/reference/notes.md \"Notes\"",
    ].join("\n"));
  });
});
