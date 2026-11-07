import { LazyStore } from "@tauri-apps/plugin-store";
import { isTauri } from "@tauri-apps/api/core";
import type { DrawingPreferences } from "@maca/drawing-react";

const VIM_MODE_KEY = "vimMode";
const SHOW_TOC_KEY = "showToc";
const RSPRESS_MODE_KEY = "rspressMode";
const DRAWING_PREFERENCES_KEY = "drawingPreferences";

export interface PreferenceStore {
  get<T>(key: string): Promise<T | null | undefined>;
  set(key: string, value: unknown): Promise<void>;
  save(): Promise<void>;
}

interface EditorPreferences {
  vimMode: boolean;
  showToc: boolean;
  rspressMode: boolean;
  drawingPreferences: DrawingPreferences;
}

const settingsStore = new LazyStore("settings.json", { autoSave: false });

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

export async function saveEditorPreferences(
  preferences: EditorPreferences,
  store: PreferenceStore = settingsStore,
): Promise<void> {
  if (store === settingsStore && !isTauri()) return;
  await store.set(VIM_MODE_KEY, preferences.vimMode);
  await store.set(SHOW_TOC_KEY, preferences.showToc);
  await store.set(RSPRESS_MODE_KEY, preferences.rspressMode);
  await store.set(DRAWING_PREFERENCES_KEY, preferences.drawingPreferences);
  await store.save();
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

export async function loadVimMode(
  store: PreferenceStore = settingsStore,
): Promise<boolean> {
  return loadBooleanPreference(VIM_MODE_KEY, store);
}

export async function loadShowToc(
  store: PreferenceStore = settingsStore,
): Promise<boolean> {
  return loadBooleanPreference(SHOW_TOC_KEY, store);
}

export async function loadRspressMode(
  store: PreferenceStore = settingsStore,
): Promise<boolean> {
  return loadBooleanPreference(RSPRESS_MODE_KEY, store);
}
