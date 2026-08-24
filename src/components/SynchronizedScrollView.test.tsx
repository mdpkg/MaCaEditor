import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { interpolateScroll, SynchronizedScrollView } from "./SynchronizedScrollView";

function dimensions(element: HTMLElement, scrollHeight: number, clientHeight: number) {
  Object.defineProperties(element, {
    scrollHeight: { configurable: true, value: scrollHeight },
    clientHeight: { configurable: true, value: clientHeight },
  });
}

describe("SynchronizedScrollView", () => {
  const containers: HTMLDivElement[] = [];

  afterEach(() => {
    containers.splice(0).forEach((container) => container.remove());
  });

  test("interpolates independently between heading anchors", () => {
    const anchors = [
      { source: 0, target: 0 },
      { source: 100, target: 300 },
      { source: 500, target: 500 },
    ];
    expect(interpolateScroll(50, anchors)).toBe(150);
    expect(interpolateScroll(300, anchors)).toBe(400);
  });

  test("synchronizes editor and preview using their relative scroll positions", () => {
    let finishFrame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      finishFrame = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    const container = document.createElement("div");
    containers.push(container);
    document.body.append(container);
    const root = createRoot(container);

    act(() => root.render(
      <SynchronizedScrollView>
        <div className="markdown-editor"><div className="cm-scroller" /></div>
        <div className="markdown-preview" />
      </SynchronizedScrollView>,
    ));

    const editor = container.querySelector(".cm-scroller") as HTMLElement;
    const preview = container.querySelector(".markdown-preview") as HTMLElement;
    dimensions(editor, 1100, 100);
    dimensions(preview, 600, 100);

    editor.scrollTop = 500;
    act(() => editor.dispatchEvent(new Event("scroll")));
    expect(preview.scrollTop).toBe(250);

    finishFrame?.(0);
    preview.scrollTop = 400;
    act(() => preview.dispatchEvent(new Event("scroll")));
    expect(editor.scrollTop).toBe(800);

    act(() => root.unmount());
    vi.unstubAllGlobals();
  });
});
