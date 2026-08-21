import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { CodeEditor } from "./CodeEditor";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("CodeEditor", () => {
  test("uses standard mode by default and can enable Vim mode", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onChange = vi.fn();

    act(() => root.render(<CodeEditor value="alpha" onChange={onChange} language="markdown" />));
    expect(container.querySelector(".cm-editor")?.textContent).toContain("alpha");
    expect(container.querySelector(".cm-vim-panel")).toBeNull();

    act(() => root.render(<CodeEditor value="alpha" onChange={onChange} vimMode />));
    expect(container.querySelector(".cm-editor")).not.toBeNull();
    expect(container.querySelector(".cm-vim-panel")).not.toBeNull();

    act(() => root.unmount());
  });

  test("updates its document when the controlled value changes", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onChange = vi.fn();

    act(() => root.render(<CodeEditor value="before" onChange={onChange} />));
    act(() => root.render(<CodeEditor value="after" onChange={onChange} />));
    expect(container.querySelector(".cm-editor")?.textContent).toContain("after");

    act(() => root.unmount());
  });
});
