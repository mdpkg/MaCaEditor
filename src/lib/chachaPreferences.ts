import { invoke, isTauri } from "@tauri-apps/api/core";
import { normalizeChachaSettings, type ChachaSettings } from "./chachaSettings";

export async function loadChachaPreferences(): Promise<ChachaSettings> {
  try {
    if (!isTauri()) return normalizeChachaSettings();
    const values = await invoke<{ chachaPreferences?: ChachaSettings }>("read_editor_preferences");
    return normalizeChachaSettings(values.chachaPreferences ?? undefined);
  } catch {
    return normalizeChachaSettings();
  }
}

export async function saveChachaPreferences(settings: ChachaSettings): Promise<void> {
  const chachaPreferences = normalizeChachaSettings(settings);
  if (isTauri()) await invoke("save_editor_preferences", { preferences: { chachaPreferences } });
}
