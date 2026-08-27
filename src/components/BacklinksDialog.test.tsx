import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { BacklinksDialog } from "./BacklinksDialog";

test("lists backlinks and opens their Markdown source", () => {
  const onNavigate = vi.fn(); const container = document.createElement("div"); const root = createRoot(container);
  act(() => root.render(<BacklinksDialog target="images/a.png"
    backlinks={[{ path: "docs/guide.md", line: 3, offset: 20 }]}
    onNavigate={onNavigate} onClose={vi.fn()} />));
  expect(container.textContent).toContain("References to images/a.png");
  act(() => (container.querySelector(".backlinks-list button") as HTMLButtonElement).click());
  expect(onNavigate).toHaveBeenCalledWith("docs/guide.md", 20);
  act(() => root.unmount());
});
