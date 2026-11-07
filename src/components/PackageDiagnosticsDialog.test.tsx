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
    expect(container.textContent).toContain("エラー 1 件、警告 1 件");
    const issue = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("docs/guide.md:4")) as HTMLButtonElement;
    act(() => issue.click());
    expect(onNavigate).toHaveBeenCalledWith("docs/guide.md", 4, undefined);
    act(() => root.unmount());
  });

  test("sorts errors first, filters severity, and keeps results open while navigating", () => {
    const onNavigate = vi.fn(); const onClose = vi.fn();
    const host = document.createElement("div"); document.body.appendChild(host); const root = createRoot(host);
    act(() => root.render(<PackageDiagnosticsDialog diagnostics={[
      { code: "unreferenced-file", severity: "warning", message: "Unused", path: "unused.txt" },
      { code: "missing-link", severity: "error", message: "Missing", path: "index.md", line: 4, offset: 23 },
    ]} onNavigate={onNavigate} onClose={onClose} />));
    expect(host.querySelector("li")?.getAttribute("data-severity")).toBe("error");
    act(() => (host.querySelector("li button") as HTMLButtonElement).click());
    expect(onNavigate).toHaveBeenLastCalledWith("index.md", 4, 23);
    expect(onClose).not.toHaveBeenCalled();
    const filter = host.querySelector("select")!;
    act(() => { filter.value = "warning"; filter.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(host.querySelectorAll("li")).toHaveLength(1);
    expect(host.querySelector("li")?.textContent).toContain("unused.txt");
    act(() => ([...host.querySelectorAll("button")].find((item) => item.textContent === "次の問題")!).click());
    expect(onNavigate).toHaveBeenLastCalledWith("unused.txt", undefined, undefined);
    act(() => root.unmount()); host.remove();
  });

  test("shows a clean result", () => {
    const container = document.createElement("div"); const root = createRoot(container);
    act(() => root.render(<PackageDiagnosticsDialog diagnostics={[]} onNavigate={vi.fn()} onClose={vi.fn()} />));
    expect(container.textContent).toContain("問題はありません");
    act(() => root.unmount());
  });
});
