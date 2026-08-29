import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";

// Component behavior belongs to the React package boundary.
import type { DrawingDocument } from "@maca/drawing-core";
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
  test("adjusts an arc arrow's start and sweep angles from Properties", () => {
    const onDirty = vi.fn();
    const arcDoc: DrawingDocument = {
      ...initial,
      objects: [{
        id: "arc-1", type: "autoShape", preset: "arcArrow",
        x: 100, y: 100, width: 150, height: 100, rotation: 0, zIndex: 1,
        style: { fill: "#ffffff", stroke: "#000000", strokeWidth: 1 },
      }],
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    function Harness() {
      const [doc, setDoc] = useState(arcDoc);
      return <DrawingEditor doc={doc} onChange={setDoc} onDirty={onDirty} />;
    }
    act(() => root.render(<Harness />));
    const canvas = container.querySelector("svg.drawing-canvas") as SVGSVGElement;
    canvas.setPointerCapture = vi.fn();
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1200, bottom: 800,
      width: 1200, height: 800, toJSON: () => ({}),
    });
    act(() => canvas.dispatchEvent(pointerEvent("pointerdown", 170, 150)));

    const start = container.querySelector('input[aria-label="Arc arrow start angle"]') as HTMLInputElement;
    const sweep = container.querySelector('input[aria-label="Arc arrow sweep angle"]') as HTMLInputElement;
    const startMarker = container.querySelector('select[aria-label="Arc arrow start marker"]') as HTMLSelectElement;
    const endMarker = container.querySelector('select[aria-label="Arc arrow end marker"]') as HTMLSelectElement;
    expect(start.value).toBe("200");
    expect(sweep.value).toBe("220");
    expect(startMarker.value).toBe("none");
    expect(endMarker.value).toBe("arrow");
    expect(container.querySelector('[aria-label="Arc arrow start handle"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Arc arrow end handle"]')).not.toBeNull();
    act(() => {
      startMarker.value = "arrow";
      startMarker.dispatchEvent(new Event("change", { bubbles: true }));
    });
    act(() => {
      endMarker.value = "crowFoot";
      endMarker.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(start, "45");
      start.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      setter?.call(sweep, "120");
      sweep.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(onDirty.mock.lastCall?.[0].objects[0]).toMatchObject({
      adjustments: { startAngle: 45, sweepAngle: 120 },
      startMarker: "arrow",
      endMarker: "crowFoot",
    });
  });

  test("moves an arc arrow endpoint with its canvas handle", () => {
    const onDirty = vi.fn();
    const arcDoc: DrawingDocument = {
      ...initial,
      objects: [{
        id: "arc-1", type: "autoShape", preset: "arcArrow",
        x: 100, y: 100, width: 150, height: 100, rotation: 0, zIndex: 1,
        style: { stroke: "#000000", strokeWidth: 1 },
        adjustments: { startAngle: 0, sweepAngle: 90 },
      }],
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    function Harness() {
      const [doc, setDoc] = useState(arcDoc);
      return <DrawingEditor doc={doc} onChange={setDoc} onDirty={onDirty} />;
    }
    act(() => root.render(<Harness />));
    const canvas = container.querySelector("svg.drawing-canvas") as SVGSVGElement;
    canvas.setPointerCapture = vi.fn();
    canvas.hasPointerCapture = vi.fn(() => true);
    canvas.releasePointerCapture = vi.fn();
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1200, bottom: 800,
      width: 1200, height: 800, toJSON: () => ({}),
    });
    act(() => canvas.dispatchEvent(pointerEvent("pointerdown", 175, 150)));
    const endHandle = container.querySelector('[aria-label="Arc arrow end handle"]') as SVGCircleElement;

    act(() => endHandle.dispatchEvent(pointerEvent("pointerdown", 175, 188)));
    act(() => canvas.dispatchEvent(pointerEvent("pointermove", 112, 150)));
    act(() => canvas.dispatchEvent(pointerEvent("pointerup", 112, 150)));

    expect(onDirty.mock.lastCall?.[0].objects[0]).toMatchObject({
      adjustments: { startAngle: 0, sweepAngle: 180 },
    });

    const startHandle = container.querySelector('[aria-label="Arc arrow start handle"]') as SVGCircleElement;
    act(() => startHandle.dispatchEvent(pointerEvent("pointerdown", 238, 150)));
    act(() => canvas.dispatchEvent(pointerEvent("pointermove", 175, 112)));
    act(() => canvas.dispatchEvent(pointerEvent("pointerup", 175, 112)));

    expect(onDirty.mock.lastCall?.[0].objects[0]).toMatchObject({
      adjustments: { startAngle: 270, sweepAngle: 270 },
    });
  });

  test("adjusts a selected callout tail direction from Properties", () => {
    const onDirty = vi.fn();
    const calloutDoc: DrawingDocument = {
      ...initial,
      objects: [{
        id: "callout-1", type: "autoShape", preset: "callout",
        x: 100, y: 100, width: 140, height: 90, rotation: 0, zIndex: 1,
        style: { fill: "#ffffff", stroke: "#000000", strokeWidth: 1 },
      }],
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    function Harness() {
      const [doc, setDoc] = useState(calloutDoc);
      return <DrawingEditor doc={doc} onChange={setDoc} onDirty={onDirty} />;
    }
    act(() => root.render(<Harness />));
    const canvas = container.querySelector("svg.drawing-canvas") as SVGSVGElement;
    canvas.setPointerCapture = vi.fn();
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1200, bottom: 800,
      width: 1200, height: 800, toJSON: () => ({}),
    });

    act(() => canvas.dispatchEvent(pointerEvent("pointerdown", 120, 120)));
    const slider = container.querySelector('input[aria-label="Callout tail direction"]') as HTMLInputElement;
    expect(slider.value).toBe("90");

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(slider, "225");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(onDirty.mock.lastCall?.[0].objects[0]).toMatchObject({
      adjustments: { tailAngle: 225 },
    });
  });

  test("moves a callout tail with its canvas handle", () => {
    const onDirty = vi.fn();
    const calloutDoc: DrawingDocument = {
      ...initial,
      objects: [{
        id: "callout-1", type: "autoShape", preset: "callout",
        x: 100, y: 100, width: 140, height: 90, rotation: 0, zIndex: 1,
        style: { fill: "#ffffff", stroke: "#000000", strokeWidth: 1 },
        adjustments: { tailAngle: 90 },
      }],
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    function Harness() {
      const [doc, setDoc] = useState(calloutDoc);
      return <DrawingEditor doc={doc} onChange={setDoc} onDirty={onDirty} />;
    }
    act(() => root.render(<Harness />));
    const canvas = container.querySelector("svg.drawing-canvas") as SVGSVGElement;
    canvas.setPointerCapture = vi.fn();
    canvas.hasPointerCapture = vi.fn(() => true);
    canvas.releasePointerCapture = vi.fn();
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1200, bottom: 800,
      width: 1200, height: 800, toJSON: () => ({}),
    });
    act(() => canvas.dispatchEvent(pointerEvent("pointerdown", 170, 145)));
    const handle = container.querySelector('[aria-label="Callout tail handle"]') as SVGCircleElement;

    act(() => handle.dispatchEvent(pointerEvent("pointerdown", 170, 215.2)));
    act(() => canvas.dispatchEvent(pointerEvent("pointermove", 80, 145)));
    act(() => canvas.dispatchEvent(pointerEvent("pointerup", 80, 145)));

    expect(onDirty.mock.lastCall?.[0].objects[0]).toMatchObject({
      adjustments: { tailAngle: 180 },
    });
  });

  test("moves a brace tail vertically with its canvas handle", () => {
    const onDirty = vi.fn();
    const braceDoc: DrawingDocument = {
      ...initial,
      objects: [{
        id: "brace-1", type: "autoShape", preset: "rightBrace",
        x: 100, y: 100, width: 50, height: 120, rotation: 0, zIndex: 1,
        style: { stroke: "#000000", strokeWidth: 1 },
        adjustments: { tailPosition: 0.5 },
      }],
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    function Harness() {
      const [doc, setDoc] = useState(braceDoc);
      return <DrawingEditor doc={doc} onChange={setDoc} onDirty={onDirty} />;
    }
    act(() => root.render(<Harness />));
    const canvas = container.querySelector("svg.drawing-canvas") as SVGSVGElement;
    canvas.setPointerCapture = vi.fn();
    canvas.hasPointerCapture = vi.fn(() => true);
    canvas.releasePointerCapture = vi.fn();
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1200, bottom: 800,
      width: 1200, height: 800, toJSON: () => ({}),
    });
    act(() => canvas.dispatchEvent(pointerEvent("pointerdown", 125, 160)));
    const handle = container.querySelector('[aria-label="Brace tail handle"]') as SVGCircleElement;
    expect(handle).not.toBeNull();

    act(() => handle.dispatchEvent(pointerEvent("pointerdown", 100, 160)));
    act(() => canvas.dispatchEvent(pointerEvent("pointermove", 100, 190)));
    act(() => canvas.dispatchEvent(pointerEvent("pointerup", 100, 190)));

    expect(onDirty.mock.lastCall?.[0].objects[0]).toMatchObject({
      adjustments: { tailPosition: 0.75 },
    });
  });

  test("opens shape properties in a context menu and applies changes", () => {
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

    act(() => canvas.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true, cancelable: true, clientX: 110, clientY: 110,
    })));

    const menu = document.querySelector(".drawing-context-menu") as HTMLDivElement;
    expect(menu).not.toBeNull();
    expect(menu.querySelector('input[aria-label="Fill opacity"]')).not.toBeNull();
    const lineWeight = menu.querySelector('select[aria-label="Line weight"]') as HTMLSelectElement;
    expect(lineWeight).not.toBeNull();
    const weightPresets = Array.from(lineWeight.querySelectorAll("option"))
      .map((option) => (option as HTMLOptionElement).value);
    expect(weightPresets).toHaveLength(9);
    expect(weightPresets).toEqual(expect.arrayContaining(["3", "6"]));
    expect(menu.querySelector('select[aria-label="H Align"]')).not.toBeNull();
    expect(menu.querySelector('select[aria-label="V Align"]')).not.toBeNull();
    expect(menu.querySelector('button[aria-label="Bring to Front"]')).not.toBeNull();
    expect(menu.querySelector('button[aria-label="Bring Forward"]')).not.toBeNull();
    expect(menu.querySelector('button[aria-label="Send Backward"]')).not.toBeNull();
    expect(menu.querySelector('button[aria-label="Send to Back"]')).not.toBeNull();
    const red = menu.querySelector('[data-color-kind="fill"][title="Red"]') as HTMLButtonElement;
    act(() => red.click());
    act(() => {
      lineWeight.value = "3";
      lineWeight.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const horizontal = document.querySelector('select[aria-label="H Align"]') as HTMLSelectElement;
    act(() => {
      horizontal.value = "right";
      horizontal.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const vertical = document.querySelector('select[aria-label="V Align"]') as HTMLSelectElement;
    act(() => {
      vertical.value = "bottom";
      vertical.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const sendToBack = document.querySelector('button[aria-label="Send to Back"]') as HTMLButtonElement;
    act(() => sendToBack.click());
    const changed = onDirty.mock.calls[onDirty.mock.calls.length - 1]?.[0] as DrawingDocument;
    expect(changed.objects[0].style).toMatchObject({ fill: "#ff0000", strokeWidth: 3 });
    expect(changed.objects[0]).toMatchObject({
      zIndex: 0,
      textStyle: { align: "right", verticalAlign: "bottom" },
    });
    act(() => root.unmount());
  });

  test("opens connector properties in a context menu", () => {
    const onDirty = vi.fn();
    const connectorDoc: DrawingDocument = {
      ...initial,
      objects: [
        initial.objects[0],
        { ...initial.objects[0], id: "rect-2", x: 300, zIndex: 2 },
        {
          id: "connector-1", type: "connector", x: 0, y: 0, width: 0, height: 0,
          rotation: 0, zIndex: 3, from: { objectId: "rect-1" },
          to: { objectId: "rect-2" }, style: {},
        },
      ],
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <DrawingEditor doc={connectorDoc} onChange={vi.fn()} onDirty={onDirty} />,
    ));
    const canvas = container.querySelector("svg.drawing-canvas") as SVGSVGElement;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1200, bottom: 800,
      width: 1200, height: 800, toJSON: () => ({}),
    });

    act(() => canvas.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true, cancelable: true, clientX: 240, clientY: 120,
    })));

    const menu = document.querySelector(".drawing-context-menu") as HTMLDivElement;
    const lineWeight = menu.querySelector('select[aria-label="Line weight"]') as HTMLSelectElement;
    expect(lineWeight).not.toBeNull();
    expect(menu.textContent).toContain("Line opacity");
    expect(menu.textContent).toContain("Start");
    expect(menu.textContent).toContain("End");
    expect(menu.textContent).not.toContain("Fill opacity");
    act(() => {
      lineWeight.value = "4.5";
      lineWeight.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onDirty.mock.lastCall?.[0].objects.find((object: { id: string }) => object.id === "connector-1").style)
      .toMatchObject({ strokeWidth: 4.5 });
    act(() => root.unmount());
  });

  test("opens the selected group child's context menu", () => {
    const child = initial.objects[0];
    const grouped: DrawingDocument = {
      ...initial,
      objects: [{
        id: "group-1", type: "group", x: 100, y: 100, width: 280, height: 80,
        rotation: 0, zIndex: 1, style: {}, members: [
          child,
          { ...child, id: "rect-2", x: 300, zIndex: 2 },
        ],
      }],
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <DrawingEditor doc={grouped} onChange={vi.fn()} onDirty={vi.fn()} />,
    ));
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
    act(() => canvas.dispatchEvent(new MouseEvent("dblclick", {
      bubbles: true, cancelable: true, clientX: 110, clientY: 110,
    })));
    expect(container.querySelector(".selection-box rect")?.getAttribute("width")).toBe("88");

    act(() => canvas.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true, cancelable: true, clientX: 110, clientY: 110,
    })));

    const menu = document.querySelector(".drawing-context-menu") as HTMLDivElement;
    expect(menu).not.toBeNull();
    expect(menu.textContent).toContain("Fill");
    expect(menu.querySelector('select[aria-label="H Align"]')).not.toBeNull();
    act(() => root.unmount());
  });

  test("shows only z-order actions for image and group context menus", () => {
    const child = initial.objects[0];
    const doc: DrawingDocument = {
      ...initial,
      objects: [
        {
          id: "image-1", type: "image", x: 100, y: 100, width: 80, height: 40,
          rotation: 0, zIndex: 1, src: "data:image/png;base64,AAAA", style: {},
        },
        {
          id: "group-1", type: "group", x: 300, y: 100, width: 80, height: 40,
          rotation: 0, zIndex: 2, style: {}, members: [{ ...child, x: 300 }],
        },
      ],
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<DrawingEditor doc={doc} onChange={vi.fn()} onDirty={vi.fn()} />));
    const canvas = container.querySelector("svg.drawing-canvas") as SVGSVGElement;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1200, bottom: 800,
      width: 1200, height: 800, toJSON: () => ({}),
    });

    for (const x of [110, 310]) {
      act(() => canvas.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true, cancelable: true, clientX: x, clientY: 110,
      })));
      const menu = document.querySelector(".drawing-context-menu") as HTMLDivElement;
      expect(menu.querySelectorAll("button")).toHaveLength(4);
      expect(menu.querySelectorAll("input, select")).toHaveLength(0);
      expect(menu.textContent).toBe("FrontFwdBackBack");
    }
    act(() => root.unmount());
  });


  test("applies preset colors to fill and line", () => {
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
    act(() => canvas.dispatchEvent(pointerEvent("pointerdown", 110, 110)));
    const fillRed = container.querySelector('[data-color-kind="fill"][title="Red"]') as HTMLButtonElement;
    const lineBlue = container.querySelector('[data-color-kind="stroke"][title="Blue"]') as HTMLButtonElement;
    act(() => fillRed.click());
    act(() => lineBlue.click());
    const changed = onDirty.mock.calls[onDirty.mock.calls.length - 1]?.[0] as DrawingDocument;
    expect(changed.objects[0].style).toMatchObject({ fill: "#ff0000", stroke: "#0070c0" });
    expect(container.querySelectorAll('[data-color-kind="fill"]')).toHaveLength(12);
    act(() => root.unmount());
  });

  test("edits fill and line opacity independently", () => {
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
    act(() => canvas.dispatchEvent(pointerEvent("pointerdown", 110, 110)));

    const setNumberInput = (label: string, value: string) => {
      const input = container.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    act(() => setNumberInput("Fill opacity", "35"));
    act(() => setNumberInput("Line opacity", "60"));

    const changed = onDirty.mock.calls[onDirty.mock.calls.length - 1]?.[0] as DrawingDocument;
    expect(changed.objects[0].style).toMatchObject({ fillOpacity: 0.35, strokeOpacity: 0.6 });
    act(() => root.unmount());
  });

  test("rotates a selected shape from Properties", () => {
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
    act(() => canvas.dispatchEvent(pointerEvent("pointerdown", 110, 110)));
    const rotation = container.querySelector('input[aria-label="Rotation"]') as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(rotation, "45");
      rotation.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const changed = onDirty.mock.calls[onDirty.mock.calls.length - 1]?.[0] as DrawingDocument;
    expect(changed.objects[0].rotation).toBe(45);
    expect(container.querySelector(".selection-box")?.getAttribute("transform"))
      .toBe("rotate(45 140 120)");
    act(() => root.unmount());
  });

  test("selects a rotated shape outside its original bounds", () => {
    const rotated = {
      ...initial,
      objects: [{ ...initial.objects[0], rotation: 90 }],
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <DrawingEditor doc={rotated} onChange={vi.fn()} onDirty={vi.fn()} />,
    ));
    const canvas = container.querySelector("svg.drawing-canvas") as SVGSVGElement;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1200, bottom: 800,
      width: 1200, height: 800, toJSON: () => ({}),
    });
    canvas.setPointerCapture = vi.fn();

    act(() => canvas.dispatchEvent(pointerEvent("pointerdown", 140, 85)));

    expect(container.querySelector('input[aria-label="Rotation"]')).not.toBeNull();
    act(() => root.unmount());
  });

  test("rotates a shape by dragging its rotation handle", () => {
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
    const handle = container.querySelector(".object-rotate-handle") as SVGCircleElement;

    act(() => handle.dispatchEvent(pointerEvent("pointerdown", 140, 72)));
    act(() => canvas.dispatchEvent(pointerEvent("pointermove", 190, 120)));
    act(() => canvas.dispatchEvent(pointerEvent("pointerup", 190, 120)));

    const changed = onDirty.mock.calls[onDirty.mock.calls.length - 1]?.[0] as DrawingDocument;
    expect(changed.objects[0].rotation).toBe(90);
    act(() => root.unmount());
  });

  test("inserts an elbow connector between two shapes", () => {
    const onDirty = vi.fn();
    const second = { ...initial.objects[0], id: "rect-2", x: 300, y: 200, zIndex: 2 };
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
    const connectorMenu = container.querySelector('select[aria-label="Connector"]') as HTMLSelectElement;
    expect([...connectorMenu.options].map((option) => option.text)).toEqual([
      "Connector",
      "Straight",
      "Curve",
      "Elbow",
    ]);
    act(() => {
      connectorMenu.value = "elbowConnector";
      connectorMenu.dispatchEvent(new Event("change", { bubbles: true }));
    });
    act(() => canvas.dispatchEvent(pointerEvent("pointerdown", 110, 110)));
    act(() => canvas.dispatchEvent(pointerEvent("pointerdown", 310, 210)));

    const changed = onDirty.mock.calls[onDirty.mock.calls.length - 1]?.[0] as DrawingDocument;
    expect(changed.objects[2]).toMatchObject({
      type: "connector",
      from: { objectId: "rect-1" },
      to: { objectId: "rect-2" },
      elbow: true,
    });
    const selectButton = [...container.querySelectorAll(".drawing-toolbar button")]
      .find((button) => button.textContent === "Select");
    expect(selectButton?.classList.contains("active")).toBe(true);

    canvas.hasPointerCapture = vi.fn(() => true);
    canvas.releasePointerCapture = vi.fn();
    act(() => canvas.dispatchEvent(pointerEvent("pointerdown", 600, 500)));
    act(() => canvas.dispatchEvent(pointerEvent("pointerup", 600, 500)));
    expect(container.querySelector(".connector-selection")).toBeNull();

    act(() => canvas.dispatchEvent(pointerEvent("pointerdown", 240, 170)));
    expect(container.querySelector(".connector-selection")).not.toBeNull();
    const colorInput = container.querySelector('.inspector-row input[type="color"]');
    expect(colorInput).not.toBeNull();
    const startMenu = container.querySelector('select[aria-label="Connector start"]') as HTMLSelectElement;
    const endMenu = container.querySelector('select[aria-label="Connector end"]') as HTMLSelectElement;
    expect(startMenu.value).toBe("none");
    expect(endMenu.value).toBe("arrow");
    const startSize = container.querySelector('select[aria-label="Connector start size"]') as HTMLSelectElement;
    const endSize = container.querySelector('select[aria-label="Connector end size"]') as HTMLSelectElement;
    expect(startSize.value).toBe("medium");
    expect(endSize.value).toBe("medium");
    act(() => {
      startMenu.value = "crowFoot";
      startMenu.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const withCrowFoot = onDirty.mock.calls[onDirty.mock.calls.length - 1]?.[0] as DrawingDocument;
    expect(withCrowFoot.objects[2]).toMatchObject({ startMarker: "crowFoot", endMarker: "arrow" });
    act(() => {
      startSize.value = "small";
      startSize.dispatchEvent(new Event("change", { bubbles: true }));
    });
    act(() => {
      endSize.value = "large";
      endSize.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const withSizes = onDirty.mock.calls[onDirty.mock.calls.length - 1]?.[0] as DrawingDocument;
    expect(withSizes.objects[2]).toMatchObject({ startMarkerSize: "small", endMarkerSize: "large" });
    act(() => root.unmount());
  });

  test("adjusts a curved connector with one central yellow handle", () => {
    const onDirty = vi.fn();
    const starting: DrawingDocument = {
      ...initial,
      objects: [
        { ...initial.objects[0], id: "a", x: 0, y: 0, width: 100, height: 50 },
        { ...initial.objects[0], id: "b", x: 300, y: 200, width: 100, height: 50, zIndex: 2 },
        {
          id: "curve-1", type: "connector", x: 0, y: 0, width: 0, height: 0,
          rotation: 0, zIndex: 3, from: { objectId: "a" }, to: { objectId: "b" },
          curve: true, style: { stroke: "#000000", strokeWidth: 1 },
        },
      ],
    };
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

    act(() => canvas.dispatchEvent(pointerEvent("pointerdown", 211, 98)));
    const handle = container.querySelector(".curve-connector-adjust-handle") as SVGCircleElement;
    expect(handle).not.toBeNull();
    expect(handle.getAttribute("fill")).toBe("#ffc000");

    act(() => handle.dispatchEvent(pointerEvent("pointerdown", 211, 98)));
    act(() => canvas.dispatchEvent(pointerEvent("pointermove", 200, 250)));
    act(() => canvas.dispatchEvent(pointerEvent("pointerup", 200, 250)));

    const changed = onDirty.mock.lastCall?.[0] as DrawingDocument;
    expect(changed.objects[2]).toMatchObject({ curveOffset: { x: 0, y: 125 } });
    act(() => root.unmount());
  });

  test("groups selected shapes and ungroups the selected group", () => {
    const onDirty = vi.fn();
    const second = {
      ...initial.objects[0],
      id: "rect-2",
      x: 300,
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
    act(() => canvas.dispatchEvent(pointerEvent("pointerdown", 110, 110)));
    act(() => canvas.dispatchEvent(pointerEvent("pointerdown", 310, 110, { ctrlKey: true })));

    const button = (label: string) => [...container.querySelectorAll("button")]
      .find((candidate) => candidate.textContent === label) as HTMLButtonElement;
    act(() => button("Group").click());

    const grouped = onDirty.mock.calls[onDirty.mock.calls.length - 1]?.[0] as DrawingDocument;
    expect(grouped.objects).toHaveLength(1);
    expect(grouped.objects[0]).toMatchObject({ type: "group" });
    expect(button("Ungroup")).toBeDefined();

    act(() => button("Ungroup").click());

    const ungrouped = onDirty.mock.calls[onDirty.mock.calls.length - 1]?.[0] as DrawingDocument;
    expect(ungrouped.objects.map((object) => object.id).sort()).toEqual(["rect-1", "rect-2"]);
    act(() => root.unmount());
  });

  test("selects a child only after double-clicking an already selected group", () => {
    const child = initial.objects[0];
    const grouped: DrawingDocument = {
      ...initial,
      objects: [{
        id: "group-1", type: "group", x: 100, y: 100, width: 280, height: 80,
        rotation: 0, zIndex: 1, style: {}, members: [
          child,
          { ...child, id: "rect-2", x: 300, zIndex: 2 },
        ],
      }],
    };
    const onDirty = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    function Harness() {
      const [doc, setDoc] = useState(grouped);
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
    expect(container.querySelector(".selection-box rect")?.getAttribute("width")).toBe("288");

    act(() => canvas.dispatchEvent(pointerEvent("pointerdown", 110, 110)));
    act(() => canvas.dispatchEvent(pointerEvent("pointerup", 110, 110)));
    expect(container.querySelector(".selection-box rect")?.getAttribute("width")).toBe("288");

    act(() => canvas.dispatchEvent(new MouseEvent("dblclick", {
      bubbles: true, cancelable: true, clientX: 110, clientY: 110,
    })));
    expect(container.querySelector(".selection-box rect")?.getAttribute("width")).toBe("88");

    act(() => canvas.dispatchEvent(pointerEvent("pointerdown", 110, 110)));
    act(() => canvas.dispatchEvent(pointerEvent("pointermove", 130, 130)));
    act(() => canvas.dispatchEvent(pointerEvent("pointerup", 130, 130)));
    const changed = onDirty.mock.calls[onDirty.mock.calls.length - 1]?.[0] as DrawingDocument;
    expect(changed.objects[0].type).toBe("group");
    if (changed.objects[0].type === "group") {
      expect(changed.objects[0]).toMatchObject({ x: 120, y: 100, width: 260, height: 60 });
      expect(changed.objects[0].members[0]).toMatchObject({ id: "rect-1", x: 120, y: 120 });
      expect(changed.objects[0].members[1]).toMatchObject({ id: "rect-2", x: 300, y: 100 });
    }
    act(() => root.unmount());
  });

  test("deletes the selected group with Delete", () => {
    const group: DrawingDocument["objects"][number] = {
      id: "group-1", type: "group", x: 100, y: 100, width: 80, height: 40,
      rotation: 0, zIndex: 1, style: {}, members: [initial.objects[0]],
    };
    const doc = { ...initial, objects: [group] };
    const onDirty = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<DrawingEditor doc={doc} onChange={vi.fn()} onDirty={onDirty} />));
    const editor = container.querySelector(".drawing-editor") as HTMLDivElement;
    const canvas = container.querySelector("svg.drawing-canvas") as SVGSVGElement;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1200, bottom: 800,
      width: 1200, height: 800, toJSON: () => ({}),
    });
    canvas.setPointerCapture = vi.fn();

    act(() => canvas.dispatchEvent(pointerEvent("pointerdown", 110, 110)));
    expect(document.activeElement).toBe(editor);
    act(() => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Delete", bubbles: true, cancelable: true,
    })));

    const changed = onDirty.mock.calls[onDirty.mock.calls.length - 1]?.[0] as DrawingDocument;
    expect(changed.objects).toEqual([]);
    act(() => root.unmount());
  });

  test("duplicates the selected shape with Ctrl+D", () => {
    const onDirty = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<DrawingEditor doc={initial} onChange={vi.fn()} onDirty={onDirty} />));
    const editor = container.querySelector(".drawing-editor") as HTMLDivElement;
    const canvas = container.querySelector("svg.drawing-canvas") as SVGSVGElement;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1200, bottom: 800,
      width: 1200, height: 800, toJSON: () => ({}),
    });
    canvas.setPointerCapture = vi.fn();

    act(() => canvas.dispatchEvent(pointerEvent("pointerdown", 110, 110)));
    expect(document.activeElement).toBe(editor);
    act(() => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", {
      key: "d", ctrlKey: true, bubbles: true, cancelable: true,
    })));

    const changed = onDirty.mock.calls[onDirty.mock.calls.length - 1]?.[0] as DrawingDocument;
    expect(changed.objects).toHaveLength(2);
    expect(changed.objects[1]).toMatchObject({ x: 120, y: 120 });
    act(() => root.unmount());
  });

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
    const shapeMenu = container.querySelector('button[aria-label="Shape"]') as HTMLButtonElement;
    act(() => shapeMenu.click());
    const rectangleItem = Array.from(container.querySelectorAll('.shape-picker-item'))
      .find((item) => item.textContent === "Rect") as HTMLButtonElement;
    act(() => rectangleItem.click());
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

  test("groups shape tools in an icon menu", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <DrawingEditor doc={initial} onChange={vi.fn()} onDirty={vi.fn()} />,
    ));

    const trigger = container.querySelector('button[aria-label="Shape"]') as HTMLButtonElement;
    act(() => trigger.click());
    const options = Array.from(container.querySelectorAll(".shape-picker-item"))
      .map((option) => option.textContent);
    expect(options).toEqual(expect.arrayContaining([
      "Rect", "Round Rect", "Ellipse", "File", "User",
      "Cylinder", "Cube", "Callout", "Decision", "Document",
      "Left Arrow", "Right Arrow", "Up / Down Arrow",
    ]));
    expect(Array.from(container.querySelectorAll(".shape-picker-category-label")).map((label) => label.textContent))
      .toEqual(["Basic Shapes", "Basic", "Flowchart", "Arrows"]);
    expect(container.querySelectorAll(".shape-picker-icon")).toHaveLength(options.length);
    const buttons = Array.from(container.querySelectorAll(".drawing-toolbar > button"))
      .map((button) => button.textContent);
    expect(buttons).not.toContain("File");
    expect(buttons).not.toContain("User");

    act(() => root.unmount());
  });

  test.each([
    ["Connector", "connector"],
  ])("returns to Select when the %s menu placeholder is selected", (label, tool) => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <DrawingEditor doc={initial} onChange={vi.fn()} onDirty={vi.fn()} />,
    ));
    const menu = container.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;

    act(() => {
      menu.value = tool;
      menu.dispatchEvent(new Event("change", { bubbles: true }));
    });
    act(() => {
      menu.value = "";
      menu.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const selectButton = [...container.querySelectorAll(".drawing-toolbar button")]
      .find((button) => button.textContent === "Select");
    expect(selectButton?.classList.contains("active")).toBe(true);
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

  test("aligns and edits a standalone text object's bounding box", async () => {
    const onDirty = vi.fn();
    const textDoc: DrawingDocument = {
      ...initial,
      objects: [{
        id: "text-1", type: "text", x: 100, y: 100, width: 100, height: 20,
        rotation: 0, zIndex: 1, text: "Text", style: { fontSize: 16, color: "#000000" },
      }],
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    function Harness() {
      const [doc, setDoc] = useState(textDoc);
      return <DrawingEditor doc={doc} onChange={setDoc} onDirty={onDirty} />;
    }

    act(() => root.render(<Harness />));
    const canvas = container.querySelector("svg.drawing-canvas") as SVGSVGElement;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1200, bottom: 800,
      width: 1200, height: 800, toJSON: () => ({}),
    });
    canvas.setPointerCapture = vi.fn();

    act(() => canvas.dispatchEvent(pointerEvent("pointerdown", 110, 110)));
    expect(container.querySelector(".selection-box rect")?.getAttribute("y")).toBe("96");
    expect(container.querySelector('svg text')?.getAttribute("dominant-baseline")).toBe("hanging");

    const textarea = container.querySelector(".inspector-row textarea") as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(textarea, "Changed text");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect((onDirty.mock.lastCall?.[0] as DrawingDocument).objects[0]).toMatchObject({
      text: "Changed text",
    });

    await act(async () => {
      canvas.dispatchEvent(new MouseEvent("dblclick", {
        bubbles: true, clientX: 110, clientY: 110,
      }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.activeElement?.tagName).toBe("TEXTAREA");
    act(() => root.unmount());
  });
});
