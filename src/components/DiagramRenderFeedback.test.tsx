import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { MathJaxEditor } from "./MathJaxEditor";
import { MermaidEditor } from "./MermaidEditor";
import { PlantUmlEditor } from "./PlantUmlEditor";

vi.mock("./CodeEditor", () => ({ CodeEditor: () => null }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test.each([
  ["PlantUML", PlantUmlEditor],
  ["Mermaid", MermaidEditor],
  ["MathJax", MathJaxEditor],
])("%s shows Japanese render feedback with the original error in details", async (_name, Editor) => {
  vi.useFakeTimers();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    let fail!: (reason: Error) => void;
    const render = () => new Promise<string>((_, reject) => { fail = reject; });
    act(() => root.render(<Editor source="sample" initialSvg="" render={render}
      onSourceChange={vi.fn()} onRendered={vi.fn()} />));
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });
    expect(container.textContent).toContain("描画しています…");

    await act(async () => fail(new Error("Unexpected token on line 2")));
    expect(container.textContent).not.toContain("描画しています…");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("図の描画に失敗しました。");
    const details = container.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")?.textContent).toBe("詳細");
    expect(details.textContent).toContain("Unexpected token on line 2");
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  }
});
