import { LazyStore } from "@tauri-apps/plugin-store";

const VIM_MODE_KEY = "vimMode";
const SHOW_TOC_KEY = "showToc";
const RSPRESS_MODE_KEY = "rspressMode";

export interface PreferenceStore {
  get<T>(key: string): Promise<T | null | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

const settingsStore = new LazyStore("settings.json");

async function loadBooleanPreference(
  key: string,
  store: PreferenceStore,
): Promise<boolean> {
  try {
    return await store.get<boolean>(key) === true;
  } catch {
    return false;
  }
}

async function saveBooleanPreference(
  key: string,
  enabled: boolean,
  store: PreferenceStore,
): Promise<void> {
  try {
    await store.set(key, enabled);
  } catch {
    // Keep editing available when persistent storage is unavailable.
  }
}

export async function loadVimMode(
  store: PreferenceStore = settingsStore,
): Promise<boolean> {
  return loadBooleanPreference(VIM_MODE_KEY, store);
}

export async function saveVimMode(
  enabled: boolean,
  store: PreferenceStore = settingsStore,
): Promise<void> {
  return saveBooleanPreference(VIM_MODE_KEY, enabled, store);
}

export async function loadShowToc(
  store: PreferenceStore = settingsStore,
): Promise<boolean> {
  return loadBooleanPreference(SHOW_TOC_KEY, store);
}

export async function saveShowToc(
  enabled: boolean,
  store: PreferenceStore = settingsStore,
): Promise<void> {
  return saveBooleanPreference(SHOW_TOC_KEY, enabled, store);
}

export async function loadRspressMode(
  store: PreferenceStore = settingsStore,
): Promise<boolean> {
  return loadBooleanPreference(RSPRESS_MODE_KEY, store);
}

export async function saveRspressMode(
  enabled: boolean,
  store: PreferenceStore = settingsStore,
): Promise<void> {
  return saveBooleanPreference(RSPRESS_MODE_KEY, enabled, store);
}
