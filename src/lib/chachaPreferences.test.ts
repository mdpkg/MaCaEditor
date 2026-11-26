import { expect, test, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => true }));
import { invoke } from "@tauri-apps/api/core";
import { loadChachaPreferences, saveChachaPreferences } from "./chachaPreferences";
import { DEFAULT_CHACHA_PROMPT } from "./chachaSettings";

test("保存済み人格を復元し、旧頻度・有効化状態を保存しない", async () => {
  vi.mocked(invoke).mockResolvedValueOnce({ chachaPreferences: { prompt: "読者", frequency: "restrained", enabled: true } });
  expect(await loadChachaPreferences()).toEqual({ prompt: "読者" });
  await saveChachaPreferences({ prompt: "新しい読者" });
  expect(invoke).toHaveBeenLastCalledWith("save_editor_preferences", { preferences: { chachaPreferences: { prompt: "新しい読者" } } });
});
test("古い設定・壊れた設定・読込失敗では初期値で利用できる", async () => {
  for (const value of [{}, { chachaPreferences: null }, { chachaPreferences: { prompt: "あ".repeat(10001) } }]) {
    vi.mocked(invoke).mockResolvedValueOnce(value);
    expect(await loadChachaPreferences()).toEqual({ prompt: DEFAULT_CHACHA_PROMPT });
  }
  vi.mocked(invoke).mockRejectedValueOnce(new Error("unavailable"));
  expect(await loadChachaPreferences()).toEqual({ prompt: DEFAULT_CHACHA_PROMPT });
});
test("保存失敗を呼出元へ伝え、過長入力を送信しない", async () => {
  vi.mocked(invoke).mockRejectedValueOnce(new Error("disk full"));
  await expect(saveChachaPreferences({ prompt: "読者" })).rejects.toThrow("disk full");
  vi.mocked(invoke).mockClear();
  await expect(saveChachaPreferences({ prompt: "あ".repeat(10001) })).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled();
});
