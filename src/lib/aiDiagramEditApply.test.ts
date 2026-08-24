import { describe, expect, test } from "vitest";
import { applyDiagramEdit } from "./aiDiagramEditApply";

describe("applyDiagramEdit", () => {
  test("applies an AI result to the same unchanged diagram", () => {
    expect(applyDiagramEdit("diagrams/a.puml", "source A", { path: "diagrams/a.puml", source: "source A" }, "source B"))
      .toEqual({ ok: true, source: "source B" });
  });
  test("rejects apply after a manual source change", () => {
    expect(applyDiagramEdit("diagrams/a.puml", "source B", { path: "diagrams/a.puml", source: "source A" }, "source C"))
      .toEqual({ ok: false, reason: "stale-source" });
  });
  test("rejects apply after switching diagrams", () => {
    expect(applyDiagramEdit("diagrams/b.puml", "source A", { path: "diagrams/a.puml", source: "source A" }, "source C"))
      .toEqual({ ok: false, reason: "stale-diagram" });
  });
  test("rejects an empty result", () => {
    expect(applyDiagramEdit("diagrams/a.puml", "source A", { path: "diagrams/a.puml", source: "source A" }, "  "))
      .toEqual({ ok: false, reason: "empty-result" });
  });
});
