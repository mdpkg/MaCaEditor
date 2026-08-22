import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ThirdPartyLicensesDialog } from "./ThirdPartyLicensesDialog";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ThirdPartyLicensesDialog", () => {
  test("shows the supplied license text and closes", () => {
    const onClose = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => root.render(
      <ThirdPartyLicensesDialog text={"THIRD-PARTY SOFTWARE LICENSES\nReact MIT"} onClose={onClose} />,
    ));

    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute("aria-label")).toBe("Third party licenses");
    expect(dialog?.querySelector("pre")?.textContent).toContain("React MIT");
    act(() => (container.querySelector("button") as HTMLButtonElement).click());
    expect(onClose).toHaveBeenCalledOnce();
    act(() => root.unmount());
  });
});
