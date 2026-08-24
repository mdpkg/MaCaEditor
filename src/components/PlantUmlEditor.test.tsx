import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { PlantUmlEditor } from "./PlantUmlEditor";

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

describe("PlantUmlEditor", () => {
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

    act(() => root.render(
      <PlantUmlEditor
        source={"@startuml\nA -> B\n@enduml"}
        initialSvg=""
        onSourceChange={onSourceChange}
        onRendered={onRendered}
        render={render}
        onAiEdit={onAiEdit}
      />,
    ));
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    act(() => (Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "AI Generate") as HTMLButtonElement).click());
    expect(onAiEdit).toHaveBeenCalledOnce();
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        textarea,
        "@startuml\nB -> C\n@enduml",
      );
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onSourceChange).toHaveBeenCalledWith("@startuml\nB -> C\n@enduml");
    act(() => root.render(
      <PlantUmlEditor
        source={"@startuml\nB -> C\n@enduml"}
        initialSvg=""
        onSourceChange={onSourceChange}
        onRendered={onRendered}
        render={render}
        onAiEdit={onAiEdit}
      />,
    ));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });

    expect(render).toHaveBeenLastCalledWith("@startuml\nB -> C\n@enduml");
    expect(onRendered).toHaveBeenCalledWith(
      "@startuml\nB -> C\n@enduml",
      '<svg><text>rendered</text><script>alert(1)</script></svg>',
    );
    expect(container.querySelector(".plantuml-preview text")?.textContent).toBe("rendered");
    expect(container.querySelector(".plantuml-preview script")).toBeNull();
    act(() => (container.querySelector(".plantuml-preview") as HTMLDivElement).click());
    expect(document.body.querySelector('[role="dialog"] .drawing-image text')?.textContent)
      .toBe("rendered");
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    act(() => root.unmount());
  });
});
