import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import type { DrawingDocument } from "@maca/drawing-core";
import { DrawingEditor } from "./DrawingEditor";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
afterEach(() => { act(() => root?.unmount()); document.body.innerHTML = ""; });

function mount() {
  let latest: DrawingDocument = {
    format: "maca-drawing", version: "1.0", canvas: { width: 1200, height: 800, gridSize: 10 },
    objects: [100, 300, 600].map((x, i) => ({ id: `r${i}`, type: "rectangle", x, y: 100,
      width: 80, height: 40, rotation: 0, zIndex: i, style: {} })),
  };
  latest.objects.push({ id: "c", type: "connector", from: { objectId: "r0" }, to: { objectId: "r1" },
    x: 0, y: 0, width: 0, height: 0, rotation: 0, zIndex: 4, style: {} });
  function Harness() {
    const [doc, setDoc] = useState(latest);
    latest = doc;
    return <DrawingEditor doc={doc} onChange={setDoc} onDirty={vi.fn()} />;
  }
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<Harness />));
  const canvas = container.querySelector("svg.drawing-canvas") as SVGSVGElement;
  canvas.setPointerCapture = vi.fn();
  canvas.hasPointerCapture = vi.fn(() => true);
  canvas.releasePointerCapture = vi.fn();
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0,
    right: 1200, bottom: 800, width: 1200, height: 800, toJSON: () => ({}) });
  function pointer(type: string, x: number, y: number, shiftKey = false) {
    const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, shiftKey });
    Object.defineProperty(event, "pointerId", { value: 1 });
    act(() => canvas.dispatchEvent(event));
  }
  function click(selector: string) {
    const button = container.querySelector(selector) as HTMLButtonElement;
    expect(button).not.toBeNull();
    act(() => button.click());
  }
  function undo() {
    act(() => container.querySelector('.drawing-editor')!.dispatchEvent(new KeyboardEvent("keydown", {
      key: "z", ctrlKey: true, bubbles: true,
    })));
  }
  return { container, pointer, click, undo, doc: () => latest };
}

test("distributes selected shapes and undoes the whole operation", () => {
  const ui = mount();
  for (const x of [140, 340, 640]) {
    ui.pointer("pointerdown", x, 120, x !== 140);
    ui.pointer("pointerup", x, 120);
  }
  ui.click('[aria-label="Distribute horizontally"]');
  expect(ui.doc().objects.slice(0, 3).map(o => o.x)).toEqual([100, 350, 600]);
  ui.undo();
  expect(ui.doc().objects[1].x).toBe(300);
});

test("shows alignment guides while dragging, snaps and clears guides on release", () => {
  const ui = mount();
  ui.click('[title="Toggle Snap"]');
  ui.pointer("pointerdown", 140, 120);
  ui.pointer("pointermove", 337, 170);
  expect(ui.doc().objects[0].x).toBe(300);
  expect(ui.container.querySelector('[data-smart-guide="x"]')).not.toBeNull();
  ui.pointer("pointerup", 337, 170);
  expect(ui.container.querySelector('[data-smart-guide]')).toBeNull();
  ui.undo();
  expect(ui.doc().objects[0].x).toBe(100);
});

test("can disable smart guides independently of grid snapping", () => {
  const ui = mount();
  ui.click('[title="Toggle Snap"]');
  ui.click('[aria-label="Smart guides"]');
  ui.pointer("pointerdown", 140, 120);
  ui.pointer("pointermove", 337, 170);
  expect(ui.doc().objects[0].x).toBe(297);
  expect(ui.container.querySelector('[data-smart-guide]')).toBeNull();
});

test("edits a connector label and undoes it", () => {
  const ui = mount();
  ui.pointer("pointerdown", 240, 120);
  ui.pointer("pointerup", 240, 120);
  const input = ui.container.querySelector('textarea[aria-label="Connector label"]') as HTMLTextAreaElement;
  expect(input).not.toBeNull();
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "Yes\nHTTP");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(ui.doc().objects[3]).toMatchObject({ label: "Yes\nHTTP" });
  expect(ui.container.querySelector(".connector-label")?.textContent).toBe("YesHTTP");
  ui.undo();
  expect(ui.doc().objects[3]).not.toHaveProperty("label");
});

test("double-clicking a connector focuses its label editor", () => {
  const ui = mount();
  act(() => ui.container.querySelector('svg.drawing-canvas')!.dispatchEvent(new MouseEvent("dblclick", {
    bubbles: true, clientX: 240, clientY: 120,
  })));
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Connector label");
});

test("cancelling a drag restores the document and removes guides", () => {
  const ui = mount();
  ui.pointer("pointerdown", 140, 120);
  ui.pointer("pointermove", 337, 170);
  ui.pointer("pointercancel", 337, 170);
  expect(ui.doc().objects[0].x).toBe(100);
  expect(ui.container.querySelector('[data-smart-guide]')).toBeNull();
});
