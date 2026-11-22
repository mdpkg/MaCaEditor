import { expect, test, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: vi.fn() }));
import { invoke } from "@tauri-apps/api/core";
import { loadVimMode, saveEditorPreferences } from "./editorPreferences";

test("preferences use only fixed-path native commands, retaining the settings keys", async () => {
  vi.mocked(invoke).mockResolvedValueOnce({ vimMode: true });
  await expect(loadVimMode()).resolves.toBe(true);
  expect(invoke).toHaveBeenCalledWith("read_editor_preferences");
  const preferences = { vimMode: true, showToc: false, rspressMode: true,
    drawingPreferences: { gridVisible: true, snap: false, smartGuidesEnabled: true } };
  await saveEditorPreferences(preferences);
  expect(invoke).toHaveBeenLastCalledWith("save_editor_preferences", { preferences });
});
