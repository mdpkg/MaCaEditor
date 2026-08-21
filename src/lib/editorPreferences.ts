import { LazyStore } from "@tauri-apps/plugin-store";

const VIM_MODE_KEY = "vimMode";

export interface PreferenceStore {
  get<T>(key: string): Promise<T | null | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

const settingsStore = new LazyStore("settings.json");

export async function loadVimMode(
  store: PreferenceStore = settingsStore,
): Promise<boolean> {
  try {
    return await store.get<boolean>(VIM_MODE_KEY) === true;
  } catch {
    return false;
  }
}

export async function saveVimMode(
  enabled: boolean,
  store: PreferenceStore = settingsStore,
): Promise<void> {
  try {
    await store.set(VIM_MODE_KEY, enabled);
  } catch {
    // Keep editing available when persistent storage is unavailable.
  }
}
