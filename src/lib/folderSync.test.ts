import { describe, expect, test } from "vitest";
import type { PackageInfo } from "../types";
import { createFolderDocumentState, markSaved, updateFileContent } from "./document";
import { externalFolderAction, folderInfoFingerprint } from "./folderSync";

const info: PackageInfo = {
  manifest: { title: "T", entrypoint: "README.md", version: "1.0", format: "mdpkg" },
  entrypoint: "README.md",
  files: [{ path: "README.md", is_text: true, content: "# T", base64: null }],
};

describe("Folder external synchronization", () => {
  test("fingerprint is stable across manifest key and file ordering", () => {
    const reordered: PackageInfo = {
      ...info,
      manifest: { format: "mdpkg", version: "1.0", entrypoint: "README.md", title: "T" },
      files: [...info.files].reverse(),
    };
    expect(folderInfoFingerprint(reordered)).toBe(folderInfoFingerprint(info));
  });

  test("reloads a clean document when disk content changes", () => {
    const state = createFolderDocumentState(info, "C:/docs/book");
    const changed = { ...info, files: [{ ...info.files[0], content: "# External" }] };
    expect(externalFolderAction(state, changed)).toBe("reload");
  });

  test("reports a conflict instead of overwriting dirty content", () => {
    const state = updateFileContent(createFolderDocumentState(info, "C:/docs/book"), "README.md", "# Local");
    const changed = { ...info, files: [{ ...info.files[0], content: "# External" }] };
    expect(externalFolderAction(state, changed)).toBe("conflict");
  });

  test("updates the disk baseline after a successful Folder save", () => {
    const edited = updateFileContent(createFolderDocumentState(info, "C:/docs/book"), "README.md", "# Saved");
    const saved = markSaved(edited);
    const disk = {
      ...info,
      manifest: { ...info.manifest, version: "2.0" },
      files: [{ ...info.files[0], content: "# Saved" }],
    };
    expect(externalFolderAction(saved, disk)).toBe("unchanged");
  });
});
