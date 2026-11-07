import { describe, expect, test } from "vitest";
import {
  loadDrawingPreferences,
  saveEditorPreferences,
  loadRspressMode,
  loadShowToc,
  loadVimMode,
  type PreferenceStore,
} from "./editorPreferences";

class MemoryStore implements PreferenceStore {
  private readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }

  async save(): Promise<void> {}
}

const preferences = {
  vimMode: true,
  showToc: true,
  rspressMode: true,
  drawingPreferences: { gridVisible: false, snap: true, smartGuidesEnabled: false },
};

describe("editor preferences", () => {
  test("defaults snap to off and restores the saved editor settings", async () => {
    const store = new MemoryStore();
    await expect(loadDrawingPreferences(store)).resolves.toEqual({ gridVisible: true, snap: false, smartGuidesEnabled: true });
    await saveEditorPreferences(preferences, store);
    await expect(loadVimMode(store)).resolves.toBe(true);
    await expect(loadShowToc(store)).resolves.toBe(true);
    await expect(loadRspressMode(store)).resolves.toBe(true);
    await expect(loadDrawingPreferences(store)).resolves.toEqual(preferences.drawingPreferences);
  });

  test("uses defaults for missing or invalid drawing values and tolerates unavailable storage", async () => {
    const store = new MemoryStore();
    await store.set("drawingPreferences", { gridVisible: false, snap: "false" });
    await expect(loadDrawingPreferences(store)).resolves.toEqual({ gridVisible: false, snap: false, smartGuidesEnabled: true });
    store.get = async () => { throw new Error("unavailable"); };
    await expect(loadDrawingPreferences(store)).resolves.toEqual({ gridVisible: true, snap: false, smartGuidesEnabled: true });
  });
  test("uses standard mode when no preference has been saved", async () => {
    await expect(loadVimMode(new MemoryStore())).resolves.toBe(false);
  });

  test("propagates the original error when flushing the preference store to disk fails", async () => {
    const store = new MemoryStore();
    const reason = "アクセスが拒否されました。 (os error 5)";
    store.save = async () => { throw reason; };
    await expect(saveEditorPreferences(preferences, store)).rejects.toBe(reason);
  });

  test("falls back to standard mode when the store cannot be read", async () => {
    const store = new MemoryStore();
    store.get = async () => { throw new Error("unavailable"); };
    await expect(loadVimMode(store)).resolves.toBe(false);
    await expect(loadShowToc(store)).resolves.toBe(false);
    await expect(loadRspressMode(store)).resolves.toBe(false);
  });
});
