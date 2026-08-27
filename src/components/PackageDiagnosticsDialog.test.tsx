import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test, vi } from "vitest";
import { PackageDiagnosticsDialog } from "./PackageDiagnosticsDialog";

describe("PackageDiagnosticsDialog", () => {
  test("summarizes diagnostics and navigates to their source", () => {
    const onNavigate = vi.fn();
    const container = document.createElement("div"); document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<PackageDiagnosticsDialog diagnostics={[{
      code: "missing-link", severity: "error", message: "Missing", path: "docs/guide.md", line: 4,
    }, {
      code: "unreferenced-file", severity: "warning", message: "Unused", path: "unused.txt",
    }]} onNavigate={onNavigate} onClose={vi.fn()} />));
    expect(container.textContent).toContain("1 error, 1 warning");
    const issue = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("docs/guide.md:4")) as HTMLButtonElement;
    act(() => issue.click());
    expect(onNavigate).toHaveBeenCalledWith("docs/guide.md", 4);
    act(() => root.unmount());
  });

  test("shows a clean result", () => {
    const container = document.createElement("div"); const root = createRoot(container);
    act(() => root.render(<PackageDiagnosticsDialog diagnostics={[]} onNavigate={vi.fn()} onClose={vi.fn()} />));
    expect(container.textContent).toContain("No issues found");
    act(() => root.unmount());
  });
});
