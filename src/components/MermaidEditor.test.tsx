import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MermaidEditor } from "./MermaidEditor";

vi.mock("./CodeEditor", () => ({
  CodeEditor: ({ value, onChange, className, ariaLabel }: {
    value: string;
    onChange: (value: string) => void;
    className: string;
    ariaLabel: string;
  }) => (
    <textarea
      className={className}
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("MermaidEditor", () => {
  test("edits source and renders a sanitized preview", async () => {
    vi.useFakeTimers();
    const onSourceChange = vi.fn();
    const onRendered = vi.fn();
    const onAiEdit = vi.fn();
    const render = vi.fn().mockResolvedValue(
      '<svg><text>rendered</text><script>alert(1)</script></svg>',
    );
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const props = { initialSvg: "", onSourceChange, onRendered, render, onAiEdit };

    act(() => root.render(<MermaidEditor source={"flowchart LR\nA --> B"} {...props} />));
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    act(() => (Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "AI Generate") as HTMLButtonElement).click());
    expect(onAiEdit).toHaveBeenCalledOnce();
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        textarea, "flowchart LR\nB --> C",
      );
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onSourceChange).toHaveBeenCalledWith("flowchart LR\nB --> C");
    act(() => root.render(<MermaidEditor source={"flowchart LR\nB --> C"} {...props} />));

    await act(async () => { await vi.advanceTimersByTimeAsync(350); });

    expect(render).toHaveBeenLastCalledWith("flowchart LR\nB --> C");
    expect(onRendered).toHaveBeenCalledWith(
      "flowchart LR\nB --> C", '<svg><text>rendered</text><script>alert(1)</script></svg>',
    );
    expect(container.querySelector(".mermaid-preview text")?.textContent).toBe("rendered");
    expect(container.querySelector(".mermaid-preview script")).toBeNull();
    act(() => (container.querySelector(".mermaid-preview") as HTMLDivElement).click());
    expect(document.body.querySelector('[role="dialog"] .drawing-image text')?.textContent)
      .toBe("rendered");
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    act(() => root.unmount());
  });
});
