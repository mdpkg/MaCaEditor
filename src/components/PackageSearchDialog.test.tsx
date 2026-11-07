import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { PackageSearchDialog } from "./PackageSearchDialog";

test("debounces search, highlights context, and navigates results with keys and previous/next", async () => {
  vi.useFakeTimers();
  const onNavigate = vi.fn(); const container = document.createElement("div"); document.body.appendChild(container); const root = createRoot(container);
  act(() => root.render(<PackageSearchDialog files={[
    { path: "index.md", is_text: true, content: "# Welcome", base64: null },
    { path: "docs/guide.md", is_text: true, content: "Before\n# Guide\nAfter", base64: null },
  ]} onNavigate={onNavigate} onClose={vi.fn()} />));
  const input = container.querySelector("input[type='search']") as HTMLInputElement;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "guide");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(container.querySelector(".package-search-results button")).toBeNull();
  await act(async () => vi.advanceTimersByTime(199));
  expect(container.querySelector(".package-search-results button")).toBeNull();
  await act(async () => vi.advanceTimersByTime(1));
  const result = container.querySelector(".package-search-results button") as HTMLButtonElement;
  expect(result.textContent).toContain("docs/guide.md");
  act(() => result.click());
  expect(onNavigate).toHaveBeenCalledWith("docs/guide.md", 0, 0);
  expect(container.querySelector(".search-snippet mark")?.textContent).toBe("guide");
  const last = [...container.querySelectorAll<HTMLButtonElement>(".package-search-results button")].pop()!;
  expect(last.textContent).toContain("Before");
  expect(last.textContent).toContain("After");
  act(() => result.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true })));
  expect(document.activeElement).toBe(last);
  act(() => last.click());
  expect(onNavigate).toHaveBeenLastCalledWith("docs/guide.md", 7, 7);
  const next = [...container.querySelectorAll("button")].find((item) => item.textContent === "次の結果")!;
  act(() => next.click());
  expect(onNavigate).toHaveBeenLastCalledWith("docs/guide.md", 0, 0);
  act(() => root.unmount());
  vi.useRealTimers();
});
