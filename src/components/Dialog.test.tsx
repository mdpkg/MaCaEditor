import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import { Dialog } from "./Dialog";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("traps focus in the top dialog and restores each opener", () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  function Example() {
    const [open, setOpen] = useState(false);
    const [nested, setNested] = useState(false);
    return <>
      <button onClick={() => setOpen(true)}>Open</button>
      {nested && <Dialog title="Nested" onClose={() => setNested(false)}><button>Close nested</button></Dialog>}
      {open && <Dialog title="Parent" onClose={() => setOpen(false)}>
        <button onClick={() => setNested(true)}>Open nested</button>
        <button>Last</button>
      </Dialog>}
    </>;
  }

  const press = (key: string, shiftKey = false) => act(() => document.activeElement!.dispatchEvent(
    new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true }),
  ));
  try {
    act(() => root.render(<Example />));
    const trigger = container.querySelector("button")!;
    trigger.focus();
    act(() => trigger.click());
    const parent = container.querySelector('[role="dialog"]')!;
    const first = parent.querySelector("button")!;
    expect(document.getElementById(parent.getAttribute("aria-labelledby")!)?.textContent).toBe("Parent");
    expect(document.activeElement).toBe(first);
    press("Tab", true);
    expect(document.activeElement?.textContent).toBe("Last");
    press("Tab");
    expect(document.activeElement).toBe(first);
    trigger.focus();
    expect(document.activeElement).toBe(first);

    act(() => first.click());
    expect(document.activeElement?.textContent).toBe("Close nested");
    const [nestedLayer, parentLayer] = container.querySelectorAll<HTMLElement>(".about-dialog-backdrop");
    expect(Number(nestedLayer.style.zIndex)).toBeGreaterThan(Number(parentLayer.style.zIndex));
    press("Escape");
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.activeElement).toBe(first);
    press("Escape");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
