import { describe, expect, test } from "vitest";
import {
  loadDrawingPreferences,
  saveDrawingPreferences,
  loadRspressMode,
  loadShowToc,
  loadVimMode,
  saveRspressMode,
  saveShowToc,
  saveVimMode,
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
}

describe("editor preferences", () => {
  test("defaults snap to off and restores each saved switch", async () => {
    const store = new MemoryStore();
    await expect(loadDrawingPreferences(store)).resolves.toEqual({ gridVisible: true, snap: false, smartGuidesEnabled: true });
    const preferences = { gridVisible: false, snap: true, smartGuidesEnabled: false };
    await saveDrawingPreferences(preferences, store);
    await expect(loadDrawingPreferences(store)).resolves.toEqual(preferences);
    await saveDrawingPreferences({ gridVisible: true, snap: false, smartGuidesEnabled: true }, store);
    await expect(loadDrawingPreferences(store)).resolves.toEqual({ gridVisible: true, snap: false, smartGuidesEnabled: true });
  });

  test("uses defaults for missing or invalid drawing values and tolerates unavailable storage", async () => {
    const store = new MemoryStore();
    await store.set("drawingPreferences", { gridVisible: false, snap: "false" });
    await expect(loadDrawingPreferences(store)).resolves.toEqual({ gridVisible: false, snap: false, smartGuidesEnabled: true });
    store.get = async () => { throw new Error("unavailable"); };
    await expect(loadDrawingPreferences(store)).resolves.toEqual({ gridVisible: true, snap: false, smartGuidesEnabled: true });
    store.set = async () => { throw new Error("unavailable"); };
    await expect(saveDrawingPreferences({ gridVisible: false, snap: false, smartGuidesEnabled: false }, store)).resolves.toBeUndefined();
  });
  test("uses standard mode when no preference has been saved", async () => {
    await expect(loadVimMode(new MemoryStore())).resolves.toBe(false);
  });

  test("persists and restores Vim mode", async () => {
    const store = new MemoryStore();
    await saveVimMode(true, store);
    await expect(loadVimMode(store)).resolves.toBe(true);

    await saveVimMode(false, store);
    await expect(loadVimMode(store)).resolves.toBe(false);
  });

  test("persists and restores the table of contents setting", async () => {
    const store = new MemoryStore();
    await saveShowToc(true, store);
    await expect(loadShowToc(store)).resolves.toBe(true);

    await saveShowToc(false, store);
    await expect(loadShowToc(store)).resolves.toBe(false);
  });

  test("persists and restores Rspress mode", async () => {
    const store = new MemoryStore();
    await saveRspressMode(true, store);
    await expect(loadRspressMode(store)).resolves.toBe(true);

    await saveRspressMode(false, store);
    await expect(loadRspressMode(store)).resolves.toBe(false);
  });

  test("falls back to standard mode when the store cannot be read", async () => {
    const store = new MemoryStore();
    store.get = async () => { throw new Error("unavailable"); };
    await expect(loadVimMode(store)).resolves.toBe(false);
    await expect(loadShowToc(store)).resolves.toBe(false);
    await expect(loadRspressMode(store)).resolves.toBe(false);
  });
});
