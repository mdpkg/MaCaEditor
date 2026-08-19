import { describe, expect, test } from "vitest";
import type { PackageInfo } from "../types";
import { createDocumentState, toSaveRequest, updateFileContent } from "./document";

const info: PackageInfo = {
  manifest: { format: "mdpkg", version: "1.0", entrypoint: "README.md", title: "T" },
  entrypoint: "README.md",
  files: [
    { path: "README.md", is_text: true, content: "# Hello", base64: null },
    { path: "manifest.json", is_text: true, content: "{}", base64: null },
  ],
};

describe("document state", () => {
  test("creates clean state", () => {
    const state = createDocumentState(info, "test.mdpkg");
    expect(state.dirty).toBe(false);
    expect(state.path).toBe("test.mdpkg");
  });

  test("marks dirty on update", () => {
    const state = createDocumentState(info, "test.mdpkg");
    const updated = updateFileContent(state, "README.md", "# Updated");
    expect(updated.dirty).toBe(true);
  });

  test("updates file content", () => {
    const state = createDocumentState(info, "test.mdpkg");
    const updated = updateFileContent(state, "README.md", "# Updated");
    const readme = updated.files.find((f) => f.path === "README.md");
    expect(readme?.content).toBe("# Updated");
  });

  test("builds save request", () => {
    const state = createDocumentState(info, "test.mdpkg");
    const req = toSaveRequest(state);
    expect(req.path).toBe("test.mdpkg");
    expect(req.files.length).toBe(2);
  });
});
