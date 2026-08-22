import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AboutDialog } from "./AboutDialog";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("AboutDialog", () => {
  test("shows the application version and author and closes from its button", () => {
    const onClose = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => root.render(<AboutDialog version="1.0.0" onClose={onClose} />));

    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute("aria-label")).toBe("About MaCa Editor");
    expect(dialog?.textContent).toContain("MaCa Editor");
    const details = Array.from(dialog?.querySelectorAll("dl > div") ?? []);
    expect(details[0].querySelector("dt")?.textContent).toBe("Version");
    expect(details[0].querySelector("dd")?.textContent).toBe("1.0.0");
    expect(dialog?.textContent).toContain("mikoto2000 <mikoto2000@gmail.com>");
    expect(details[2].querySelector("dt")?.textContent).toBe("License");
    expect(details[2].querySelector("dd")?.textContent).toBe("MIT License");

    act(() => (container.querySelector("button") as HTMLButtonElement).click());
    expect(onClose).toHaveBeenCalledOnce();
    act(() => root.unmount());
  });

  test("closes when Escape is pressed", () => {
    const onClose = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => root.render(<AboutDialog version="1.0.0" onClose={onClose} />));
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(onClose).toHaveBeenCalledOnce();
    act(() => root.unmount());
  });
});
