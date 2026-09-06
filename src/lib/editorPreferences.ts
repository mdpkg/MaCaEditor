import { LazyStore } from "@tauri-apps/plugin-store";
import type { DrawingPreferences } from "@maca/drawing-react";

const VIM_MODE_KEY = "vimMode";
const SHOW_TOC_KEY = "showToc";
const RSPRESS_MODE_KEY = "rspressMode";
const DRAWING_PREFERENCES_KEY = "drawingPreferences";

export interface PreferenceStore {
  get<T>(key: string): Promise<T | null | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

const settingsStore = new LazyStore("settings.json");

export async function loadDrawingPreferences(store: PreferenceStore = settingsStore): Promise<DrawingPreferences> {
  let stored: Partial<DrawingPreferences> | null | undefined;
  try {
    stored = await store.get<Partial<DrawingPreferences>>(DRAWING_PREFERENCES_KEY);
  } catch {
    // Retain defaults if storage is unavailable.
  }
  return {
    gridVisible: typeof stored?.gridVisible === "boolean" ? stored.gridVisible : true,
    snap: typeof stored?.snap === "boolean" ? stored.snap : false,
    smartGuidesEnabled: typeof stored?.smartGuidesEnabled === "boolean" ? stored.smartGuidesEnabled : true,
  };
}

export async function saveDrawingPreferences(
  preferences: DrawingPreferences,
  store: PreferenceStore = settingsStore,
): Promise<void> {
  try {
    await store.set(DRAWING_PREFERENCES_KEY, preferences);
  } catch {
    // Keep editing available when persistent storage is unavailable.
  }
}

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
