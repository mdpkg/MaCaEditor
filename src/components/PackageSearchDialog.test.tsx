import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { PackageSearchDialog } from "./PackageSearchDialog";

test("searches the package and navigates to a result", () => {
  const onNavigate = vi.fn(); const container = document.createElement("div"); const root = createRoot(container);
  act(() => root.render(<PackageSearchDialog files={[
    { path: "index.md", is_text: true, content: "# Welcome", base64: null },
    { path: "docs/guide.md", is_text: true, content: "# Guide", base64: null },
  ]} onNavigate={onNavigate} onClose={vi.fn()} />));
  const input = container.querySelector("input[type='search']") as HTMLInputElement;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "guide");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const result = container.querySelector(".package-search-results button") as HTMLButtonElement;
  expect(result.textContent).toContain("docs/guide.md");
  act(() => result.click());
  expect(onNavigate).toHaveBeenCalledWith("docs/guide.md", 0);
  act(() => root.unmount());
});
