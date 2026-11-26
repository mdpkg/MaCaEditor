import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { ChachaSettings } from "./ChachaSettings";
import * as preferences from "../lib/chachaPreferences";
import { DEFAULT_CHACHA_PROMPT } from "../lib/chachaSettings";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("人格は保存時のみ反映し、初期値に復元でき、閉じた未保存入力は破棄する", async () => {
  vi.spyOn(preferences, "loadChachaPreferences").mockResolvedValue({ prompt: "辛口の読者" });
  const save = vi.spyOn(preferences, "saveChachaPreferences").mockResolvedValue();
  const applied = vi.fn();
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<ChachaSettings onSaved={applied} />));
  const textarea = host.querySelector("textarea")!;
  expect(textarea.value).toBe("辛口の読者");
  expect(host.textContent).toContain("2,000文字");
  expect(host.querySelector("select")).toBeNull(); expect(host.textContent).toContain("30秒");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "熱心なファン");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(save).not.toHaveBeenCalled(); expect(applied).not.toHaveBeenCalled();
  act(() => [...host.querySelectorAll("button")].find((b) => b.textContent === "初期プロンプトに戻す")!.click());
  expect(textarea.value).toBe(DEFAULT_CHACHA_PROMPT);
  expect(save).not.toHaveBeenCalled();
  await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === "茶々入れ設定を保存")!.click());
  expect(save).toHaveBeenCalledWith({ prompt: DEFAULT_CHACHA_PROMPT });
  expect(applied).toHaveBeenCalledOnce();
  act(() => root.unmount()); host.remove();
});

test("未保存入力は閉じると破棄し、保存エラー時に適用通知を出さない", async () => {
  vi.spyOn(preferences, "loadChachaPreferences").mockResolvedValue({ prompt: "保存された人格" });
  const save = vi.spyOn(preferences, "saveChachaPreferences").mockRejectedValue(new Error("disk full"));
  const applied = vi.fn();
  const host = document.createElement("div"); document.body.append(host);
  let root = createRoot(host);
  await act(async () => root.render(<ChachaSettings onSaved={applied} />));
  act(() => [...host.querySelectorAll("button")].find((b) => b.textContent === "初期プロンプトに戻す")!.click());
  act(() => root.unmount());
  root = createRoot(host);
  await act(async () => root.render(<ChachaSettings onSaved={applied} />));
  expect(host.querySelector("textarea")!.value).toBe("保存された人格");
  await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === "茶々入れ設定を保存")!.click());
  expect(save).toHaveBeenCalled();
  expect(host.textContent).toContain("保存できませんでした");
  expect(applied).not.toHaveBeenCalled();
  act(() => root.unmount()); host.remove();
});
