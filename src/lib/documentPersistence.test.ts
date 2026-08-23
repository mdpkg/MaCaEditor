import { describe, expect, test, vi } from "vitest";
import type { DocumentState } from "./document";
import { exportFolderDocumentPackage, saveDocument, type PersistenceCommands } from "./documentPersistence";

function state(kind: "package" | "folder"): DocumentState {
  const path = kind === "folder" ? "C:/work/doc" : "C:/work/doc.mdpkg";
  return {
    path, origin: { kind, path }, originalPaths: ["README.md"], entrypoint: "README.md",
    manifest: { format: "mdpkg", version: "1.0", entrypoint: "README.md", title: "T" },
    files: [{ path: "README.md", is_text: true, content: "# T", base64: null }], dirty: true,
  };
}

function mocks(): PersistenceCommands {
  return { savePackage: vi.fn(), saveFolder: vi.fn(), exportPackage: vi.fn() };
}

describe("document persistence routing", () => {
  test("Package save uses package writer", async () => {
    const io = mocks();
    const saved = await saveDocument(state("package"), io);
    expect(io.savePackage).toHaveBeenCalledOnce();
    expect(io.saveFolder).not.toHaveBeenCalled();
    expect(saved.dirty).toBe(false);
  });

  test("Folder save uses folder writer and only clears dirty on success", async () => {
    const io = mocks();
    const saved = await saveDocument(state("folder"), io);
    expect(io.saveFolder).toHaveBeenCalledOnce();
    expect(saved.dirty).toBe(false);
    vi.mocked(io.saveFolder).mockRejectedValueOnce(new Error("disk full"));
    const dirty = state("folder");
    await expect(saveDocument(dirty, io)).rejects.toThrow("disk full");
    expect(dirty.dirty).toBe(true);
  });

  test("Folder export preserves origin", async () => {
    const io = mocks();
    const folder = state("folder");
    const result = await exportFolderDocumentPackage(folder, "out.mdpkg", io);
    expect(io.exportPackage).toHaveBeenCalledOnce();
    expect(result.origin).toEqual(folder.origin);
  });
});
