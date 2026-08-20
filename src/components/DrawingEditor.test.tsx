import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { DrawingDocument } from "../lib/drawing/model";
import { DrawingEditor } from "./DrawingEditor";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const initial: DrawingDocument = {
  format: "maca-drawing",
  version: "1.0",
  canvas: { width: 1200, height: 800, gridSize: 10 },
  objects: [
    {
      id: "rect-1",
      type: "rectangle",
      x: 100,
      y: 100,
      width: 80,
      height: 40,
      rotation: 0,
      zIndex: 1,
      style: { fill: "#ffffff", stroke: "#000000", strokeWidth: 1 },
    },
  ],
};

afterEach(() => {
  document.body.innerHTML = "";
});

function pointerEvent(
  type: string,
  x: number,
  y: number,
  init: MouseEventInit = {},
): MouseEvent {
  const event = new MouseEvent(type, {
    ...init,
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
  });
  Object.defineProperty(event, "pointerId", { value: 1 });
  return event;
}

describe("DrawingEditor", () => {
  test("selects multiple shapes with Ctrl+click", () => {
    const second = {
      ...initial.objects[0],
      id: "rect-2",
      x: 300,
      y: 100,
      zIndex: 2,
    };
    const doc = { ...initial, objects: [...initial.objects, second] };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<DrawingEditor doc={doc} onChange={vi.fn()} onDirty={vi.fn()} />));
    const canvas = container.querySelector("svg.drawing-canvas") as SVGSVGElement;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1200, bottom: 800,
      width: 1200, height: 800, toJSON: () => ({}),
    });
    canvas.setPointerCapture = vi.fn();

    act(() => canvas.dispatchEvent(pointerEvent("pointerdown", 110, 110)));
    act(() => canvas.dispatchEvent(pointerEvent("pointerdown", 310, 110, { ctrlKey: true })));

    expect(container.querySelectorAll(".selection-box")).toHaveLength(2);
    act(() => root.unmount());
  });

  test("moves all selected shapes when one of them is dragged", () => {
    const onDirty = vi.fn();
    const second = {
      ...initial.objects[0],
      id: "rect-2",
      x: 300,
      y: 100,
      zIndex: 2,
    };
    const starting = { ...initial, objects: [...initial.objects, second] };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    function Harness() {
      const [doc, setDoc] = useState(starting);
      return <DrawingEditor doc={doc} onChange={setDoc} onDirty={onDirty} />;
    }

    act(() => root.render(<Harness />));
    const canvas = container.querySelector("svg.drawing-canvas") as SVGSVGElement;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1200, bottom: 800,
      width: 1200, height: 800, toJSON: () => ({}),
    });
    canvas.setPointerCapture = vi.fn();
    canvas.hasPointerCapture = vi.fn(() => true);
    canvas.releasePointerCapture = vi.fn();
    act(() => canvas.dispatchEvent(pointerEvent("pointerdown", 110, 110)));
    act(() => canvas.dispatchEvent(pointerEvent("pointerdown", 310, 110, { ctrlKey: true })));
    onDirty.mockClear();

    act(() => canvas.dispatchEvent(pointerEvent("pointerdown", 110, 110)));
    act(() => canvas.dispatchEvent(pointerEvent("pointermove", 160, 140)));
    act(() => canvas.dispatchEvent(pointerEvent("pointerup", 160, 140)));

    const persisted = onDirty.mock.calls[onDirty.mock.calls.length - 1]?.[0] as DrawingDocument;
    expect(persisted.objects[0]).toMatchObject({ x: 150, y: 130 });
    expect(persisted.objects[1]).toMatchObject({ x: 350, y: 130 });
    expect(container.querySelectorAll(".selection-box")).toHaveLength(2);

    act(() => root.unmount());
  });

  test("selects multiple objects with a drag marquee", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<DrawingEditor doc={initial} onChange={vi.fn()} onDirty={vi.fn()} />));
    const canvas = container.querySelector("svg.drawing-canvas") as SVGSVGElement;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1200, bottom: 800,
      width: 1200, height: 800, toJSON: () => ({}),
    });
    canvas.setPointerCapture = vi.fn();
    canvas.hasPointerCapture = vi.fn(() => true);
    canvas.releasePointerCapture = vi.fn();

    act(() => canvas.dispatchEvent(pointerEvent("pointerdown", 50, 50)));
    act(() => canvas.dispatchEvent(pointerEvent("pointermove", 190, 160)));
    expect(container.querySelector(".selection-marquee")).not.toBeNull();
    act(() => canvas.dispatchEvent(pointerEvent("pointerup", 190, 160)));

    expect(container.querySelector('[data-object-id="rect-1"]')).not.toBeNull();
    expect(container.querySelector(".selection-marquee")).toBeNull();
    act(() => root.unmount());
  });

  test("does not delete a shape when Backspace is pressed in its text editor", () => {
    const onDirty = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    function Harness() {
      const [doc, setDoc] = useState(initial);
      return <DrawingEditor doc={doc} onChange={setDoc} onDirty={onDirty} />;
    }

    act(() => root.render(<Harness />));
    const canvas = container.querySelector("svg.drawing-canvas") as SVGSVGElement;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1200, bottom: 800,
      width: 1200, height: 800, toJSON: () => ({}),
    });
    canvas.setPointerCapture = vi.fn();
    canvas.hasPointerCapture = vi.fn(() => true);
    canvas.releasePointerCapture = vi.fn();
    act(() => canvas.dispatchEvent(pointerEvent("pointerdown", 110, 110)));
    act(() => canvas.dispatchEvent(pointerEvent("pointerup", 110, 110)));
    onDirty.mockClear();
    const textarea = container.querySelector(".inspector-row textarea") as HTMLTextAreaElement;

    act(() => textarea.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Backspace",
      bubbles: true,
      cancelable: true,
    })));

    expect(onDirty).not.toHaveBeenCalled();
    expect(container.querySelector('[data-object-id="rect-1"]')).not.toBeNull();

    act(() => root.unmount());
  });

  test("returns to Select after inserting one shape", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    function Harness() {
      const [doc, setDoc] = useState(initial);
      return <DrawingEditor doc={doc} onChange={setDoc} onDirty={vi.fn()} />;
    }

    act(() => root.render(<Harness />));
    const shapeMenu = container.querySelector('select[aria-label="Shape"]') as HTMLSelectElement;
    act(() => {
      shapeMenu.value = "rectangle";
      shapeMenu.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const canvas = container.querySelector("svg.drawing-canvas") as SVGSVGElement;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1200, bottom: 800,
      width: 1200, height: 800, toJSON: () => ({}),
    });
    canvas.setPointerCapture = vi.fn();
    canvas.hasPointerCapture = vi.fn(() => true);
    canvas.releasePointerCapture = vi.fn();

    act(() => canvas.dispatchEvent(pointerEvent("pointerdown", 300, 200)));
    act(() => canvas.dispatchEvent(pointerEvent("pointerup", 360, 240)));

    const select = Array.from(container.querySelectorAll(".drawing-toolbar button"))
      .find((button) => button.textContent === "Select");
    expect(select?.classList.contains("active")).toBe(true);

    act(() => root.unmount());
  });

  test("groups shape tools in a select menu", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <DrawingEditor doc={initial} onChange={vi.fn()} onDirty={vi.fn()} />,
    ));

    const menu = container.querySelector('select[aria-label="Shape"]') as HTMLSelectElement;
    const options = Array.from(menu.options).map((option) => option.textContent);
    expect(options).toEqual(["Shape", "Rect", "Round Rect", "Ellipse", "File", "User"]);
    const buttons = Array.from(container.querySelectorAll(".drawing-toolbar button"))
      .map((button) => button.textContent);
    expect(buttons).not.toContain("File");
    expect(buttons).not.toContain("User");

    act(() => root.unmount());
  });

  test("prevents browser text selection when dragging on the SVG canvas", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <DrawingEditor doc={initial} onChange={vi.fn()} onDirty={vi.fn()} />,
    ));
    const canvas = container.querySelector("svg.drawing-canvas") as SVGSVGElement;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1200, bottom: 800,
      width: 1200, height: 800, toJSON: () => ({}),
    });
    canvas.setPointerCapture = vi.fn();
    const event = pointerEvent("pointerdown", 110, 110);

    act(() => canvas.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(true);
    act(() => root.unmount());
  });

  test("renders Properties into the requested sidebar panel", () => {
    const panel = document.createElement("div");
    panel.id = "drawing-properties-panel";
    document.body.appendChild(panel);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => root.render(
      <DrawingEditor
        doc={initial}
        onChange={vi.fn()}
        onDirty={vi.fn()}
        propertiesPanelId="drawing-properties-panel"
      />,
    ));

    expect(panel.querySelector(".drawing-inspector")?.textContent).toContain("Properties");
    expect(container.querySelector(".drawing-inspector")).toBeNull();

    act(() => root.unmount());
  });

  test("passes the final dragged document to the persistence callback", () => {
    const onDirty = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    function Harness() {
      const [doc, setDoc] = useState(initial);
      return <DrawingEditor doc={doc} onChange={setDoc} onDirty={onDirty} />;
    }

    act(() => root.render(<Harness />));
    const canvas = container.querySelector("svg.drawing-canvas") as SVGSVGElement;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1200,
      bottom: 800,
      width: 1200,
      height: 800,
      toJSON: () => ({}),
    });
    canvas.setPointerCapture = vi.fn();
    canvas.hasPointerCapture = vi.fn(() => true);
    canvas.releasePointerCapture = vi.fn();

    act(() => canvas.dispatchEvent(pointerEvent("pointerdown", 110, 110)));
    act(() => canvas.dispatchEvent(pointerEvent("pointermove", 150, 140)));
    act(() => canvas.dispatchEvent(pointerEvent("pointerup", 150, 140)));

    const persisted = onDirty.mock.calls[onDirty.mock.calls.length - 1]?.[0] as
      | DrawingDocument
      | undefined;
    expect(persisted?.objects[0]).toMatchObject({ x: 140, y: 130 });

    act(() => root.unmount());
  });

  test("persists a canvas resized from its bottom-right handle", () => {
    const onDirty = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    function Harness() {
      const [doc, setDoc] = useState(initial);
      return <DrawingEditor doc={doc} onChange={setDoc} onDirty={onDirty} />;
    }

    act(() => root.render(<Harness />));
    const canvas = container.querySelector("svg.drawing-canvas") as SVGSVGElement;
    canvas.setPointerCapture = vi.fn();
    canvas.hasPointerCapture = vi.fn(() => true);
    canvas.releasePointerCapture = vi.fn();
    const handle = container.querySelector('[data-canvas-resize="both"]') as SVGRectElement;

    act(() => handle.dispatchEvent(pointerEvent("pointerdown", 1198, 798)));
    act(() => canvas.dispatchEvent(pointerEvent("pointermove", 998, 698)));
    act(() => canvas.dispatchEvent(pointerEvent("pointerup", 998, 698)));

    const persisted = onDirty.mock.calls[onDirty.mock.calls.length - 1]?.[0] as DrawingDocument;
    expect(persisted.canvas).toMatchObject({
      width: 1000,
      height: 700,
      fitToContent: false,
    });

    act(() => root.unmount());
  });

  test("adds a selected image to the center of the SVG canvas", async () => {
    const onDirty = vi.fn();
    const onRequestImage = vi.fn(async () => "data:image/png;base64,AQID");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    function Harness() {
      const [doc, setDoc] = useState(initial);
      return (
        <DrawingEditor
          doc={doc}
          onChange={setDoc}
          onDirty={onDirty}
          onRequestImage={onRequestImage}
        />
      );
    }

    act(() => root.render(<Harness />));
    const button = Array.from(container.querySelectorAll("button"))
      .find((candidate) => candidate.textContent === "Image") as HTMLButtonElement;
    await act(async () => button.click());

    const persisted = onDirty.mock.calls[onDirty.mock.calls.length - 1]?.[0] as DrawingDocument;
    expect(persisted.objects[persisted.objects.length - 1]).toMatchObject({
      type: "image",
      x: 520,
      y: 340,
      width: 160,
      height: 120,
      src: "data:image/png;base64,AQID",
    });

    act(() => root.unmount());
  });

  test("resizes a selected shape by dragging its corner handle", () => {
    const onDirty = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    function Harness() {
      const [doc, setDoc] = useState(initial);
      return <DrawingEditor doc={doc} onChange={setDoc} onDirty={onDirty} />;
    }

    act(() => root.render(<Harness />));
    const canvas = container.querySelector("svg.drawing-canvas") as SVGSVGElement;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1200, bottom: 800,
      width: 1200, height: 800, toJSON: () => ({}),
    });
    canvas.setPointerCapture = vi.fn();
    canvas.hasPointerCapture = vi.fn(() => true);
    canvas.releasePointerCapture = vi.fn();

    act(() => canvas.dispatchEvent(pointerEvent("pointerdown", 110, 110)));
    act(() => canvas.dispatchEvent(pointerEvent("pointerup", 110, 110)));
    const handle = container.querySelector(
      '[data-object-resize="se"][data-object-id="rect-1"]',
    ) as SVGRectElement;
    act(() => handle.dispatchEvent(pointerEvent("pointerdown", 180, 140)));
    act(() => canvas.dispatchEvent(pointerEvent("pointermove", 230, 170)));
    act(() => canvas.dispatchEvent(pointerEvent("pointerup", 230, 170)));

    const persisted = onDirty.mock.calls[onDirty.mock.calls.length - 1]?.[0] as DrawingDocument;
    expect(persisted.objects[0]).toMatchObject({ x: 100, y: 100, width: 130, height: 70 });

    act(() => root.unmount());
  });

  test("changes horizontal and vertical alignment of shape text", () => {
    const onDirty = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    function Harness() {
      const [doc, setDoc] = useState(initial);
      return <DrawingEditor doc={doc} onChange={setDoc} onDirty={onDirty} />;
    }

    act(() => root.render(<Harness />));
    const canvas = container.querySelector("svg.drawing-canvas") as SVGSVGElement;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1200, bottom: 800,
      width: 1200, height: 800, toJSON: () => ({}),
    });
    canvas.setPointerCapture = vi.fn();
    canvas.hasPointerCapture = vi.fn(() => true);
    canvas.releasePointerCapture = vi.fn();
    act(() => canvas.dispatchEvent(pointerEvent("pointerdown", 110, 110)));
    act(() => canvas.dispatchEvent(pointerEvent("pointerup", 110, 110)));

    const selectFor = (label: string) => {
      const row = Array.from(container.querySelectorAll(".inspector-row"))
        .find((candidate) => candidate.querySelector("label")?.textContent === label);
      return row?.querySelector("select") as HTMLSelectElement;
    };
    const horizontal = selectFor("H Align");
    act(() => {
      horizontal.value = "right";
      horizontal.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const vertical = selectFor("V Align");
    act(() => {
      vertical.value = "bottom";
      vertical.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const persisted = onDirty.mock.calls[onDirty.mock.calls.length - 1]?.[0] as DrawingDocument;
    expect(persisted.objects[0]).toMatchObject({
      textStyle: { align: "right", verticalAlign: "bottom" },
    });

    act(() => root.unmount());
  });

  test("writes multiline text into a selected shape", () => {
    const onDirty = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    function Harness() {
      const [doc, setDoc] = useState(initial);
      return <DrawingEditor doc={doc} onChange={setDoc} onDirty={onDirty} />;
    }

    act(() => root.render(<Harness />));
    const canvas = container.querySelector("svg.drawing-canvas") as SVGSVGElement;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1200, bottom: 800,
      width: 1200, height: 800, toJSON: () => ({}),
    });
    canvas.setPointerCapture = vi.fn();
    canvas.hasPointerCapture = vi.fn(() => true);
    canvas.releasePointerCapture = vi.fn();
    act(() => canvas.dispatchEvent(pointerEvent("pointerdown", 110, 110)));
    act(() => canvas.dispatchEvent(pointerEvent("pointerup", 110, 110)));

    const textarea = container.querySelector(".inspector-row textarea") as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, "First line\nSecond line");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const persisted = onDirty.mock.calls[onDirty.mock.calls.length - 1]?.[0] as DrawingDocument;
    expect(persisted.objects[0]).toMatchObject({ text: "First line\nSecond line" });

    act(() => root.unmount());
  });

  test("focuses the multiline Properties editor when a shape is double-clicked", async () => {
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("single line");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => root.render(
      <DrawingEditor doc={initial} onChange={vi.fn()} onDirty={vi.fn()} />,
    ));
    const canvas = container.querySelector("svg.drawing-canvas") as SVGSVGElement;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1200, bottom: 800,
      width: 1200, height: 800, toJSON: () => ({}),
    });

    await act(async () => {
      canvas.dispatchEvent(new MouseEvent("dblclick", {
        bubbles: true,
        clientX: 110,
        clientY: 110,
      }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(prompt).not.toHaveBeenCalled();
    expect(document.activeElement?.tagName).toBe("TEXTAREA");

    act(() => root.unmount());
    prompt.mockRestore();
  });
});
