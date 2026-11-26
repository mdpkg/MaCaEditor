import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { AiChatTabs } from "./AiChatTabs";
import type { AiChatSession } from "../lib/aiChatSessions";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const session = (id: string): AiChatSession => ({ id, title: id, kind: "document", path: "index.md", available: true,
  chat: { messages: [], status: "idle" }, draft: "", generation: 0, lastQuestion: "", scrollTop: 0, follow: true,
  phase: "idle", pendingConnectionConfirmation: false });

test("tabs use manual activation, roving focus and separate delete controls", () => {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container), select = vi.fn();
  act(() => root.render(<AiChatTabs sessions={[session("one"), session("two")]} selectedId="one" onSelect={select} onDelete={vi.fn()} onAdd={vi.fn()} canAdd={true} />));
  const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  expect(container.querySelector('[role="tablist"]')).not.toBeNull();
  expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1]);
  act(() => { tabs[0].focus(); tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
  expect(document.activeElement).toBe(tabs[1]);
  expect(select).not.toHaveBeenCalled();
  act(() => tabs[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect(select).toHaveBeenCalledWith("two");
  expect(tabs[0].getAttribute("aria-selected")).toBe("true");
  expect(tabs[0].getAttribute("aria-controls")).toBe("ai-chat-panel-one");
  expect(tabs.every((tab) => tab.querySelector("button") === null)).toBe(true);
  act(() => root.unmount()); container.remove();
});
test("empty non-Markdown state keeps an accessible disabled add control and reason", () => {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container), add = vi.fn();
  act(() => root.render(<AiChatTabs sessions={[]} onSelect={vi.fn()} onDelete={vi.fn()} onAdd={add} canAdd={false} />));
  const button = container.querySelector<HTMLButtonElement>('button[aria-label="文書相談を追加"]')!;
  expect(button.getAttribute("aria-disabled")).toBe("true");
  expect(container.textContent).toContain("Markdownを選ぶと追加できます");
  act(() => button.click()); expect(add).not.toHaveBeenCalled();
  act(() => root.unmount()); container.remove();
});
