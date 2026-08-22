import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MathJaxEditor } from "./MathJaxEditor";

vi.mock("./CodeEditor", () => ({
  CodeEditor: ({ value, onChange, ariaLabel }: {
    value: string; onChange: (value: string) => void; ariaLabel: string;
  }) => <textarea aria-label={ariaLabel} value={value}
    onChange={(event) => onChange(event.target.value)} />,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => { document.body.innerHTML = ""; vi.useRealTimers(); });

describe("MathJaxEditor", () => {
  test("edits TeX and renders a sanitized SVG preview", async () => {
    vi.useFakeTimers();
    const onSourceChange = vi.fn();
    const onRendered = vi.fn();
    const render = vi.fn().mockResolvedValue(
      '<svg><text>x²</text><script>alert(1)</script></svg>',
    );
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const props = { initialSvg: "", onSourceChange, onRendered, render };

    act(() => root.render(<MathJaxEditor source="x^2" {...props} />));
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, "y^2");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onSourceChange).toHaveBeenCalledWith("y^2");
    act(() => root.render(<MathJaxEditor source="y^2" {...props} />));
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });

    expect(render).toHaveBeenLastCalledWith("y^2");
    expect(onRendered).toHaveBeenCalledWith(
      "y^2", '<svg><text>x²</text><script>alert(1)</script></svg>',
    );
    expect(container.querySelector(".mathjax-preview text")?.textContent).toBe("x²");
    expect(container.querySelector(".mathjax-preview script")).toBeNull();
    act(() => (container.querySelector(".mathjax-preview") as HTMLDivElement).click());
    expect(document.body.querySelector("[role='dialog'] .preview-media-white-background")).not.toBeNull();
    act(() => root.unmount());
  });
});
