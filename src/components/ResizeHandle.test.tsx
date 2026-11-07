import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import { ResizeHandle } from "./ResizeHandle";
import { useStoredLayoutNumber } from "../lib/layoutPreferences";

test("resizes with pointer and keys, bounds values, resets, and restores saved width", () => {
  localStorage.clear();
  const host = document.createElement("div"); document.body.appendChild(host);
  let root = createRoot(host);
  function Example() {
    const [width, setWidth] = useStoredLayoutNumber("test.sidebar", 240, 120, 480);
    const [ratio, setRatio] = useState(0.5);
    return <><ResizeHandle label="幅" value={width} min={120} max={480} initial={240} onChange={setWidth} />
      <ResizeHandle label="比率" value={ratio} min={0.2} max={0.8} initial={0.5} ratio onChange={setRatio} /></>;
  }
  act(() => root.render(<Example />));
  const handle = () => host.querySelector<HTMLElement>('[aria-label="幅"]')!;
  handle().setPointerCapture = () => {};
  act(() => handle().dispatchEvent(new MouseEvent("pointerdown", { clientX: 100, button: 0, bubbles: true })));
  act(() => handle().dispatchEvent(new MouseEvent("pointermove", { clientX: 200, bubbles: true })));
  act(() => handle().dispatchEvent(new MouseEvent("pointerup", { bubbles: true })));
  expect(handle().getAttribute("aria-valuenow")).toBe("340");
  act(() => root.unmount()); root = createRoot(host);
  act(() => root.render(<Example />));
  expect(handle().getAttribute("aria-valuenow")).toBe("340");
  act(() => handle().dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
  expect(handle().getAttribute("aria-valuenow")).toBe("480");
  act(() => handle().dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
  expect(handle().getAttribute("aria-valuenow")).toBe("240");
  const ratio = host.querySelector<HTMLElement>('[aria-label="比率"]')!;
  act(() => ratio.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
  expect(ratio.getAttribute("aria-valuenow")).toBe("52");
  act(() => root.unmount()); host.remove(); localStorage.clear();
});
