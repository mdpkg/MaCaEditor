import { describe, expect, test } from "vitest";
import {
  loadVimMode,
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

  test("falls back to standard mode when the store cannot be read", async () => {
    const store = new MemoryStore();
    store.get = async () => { throw new Error("unavailable"); };
    await expect(loadVimMode(store)).resolves.toBe(false);
  });
});
