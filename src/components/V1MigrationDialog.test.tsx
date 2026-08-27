import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { V1MigrationDialog } from "./V1MigrationDialog";

test("explains v1 migration and offers overwrite or copy", () => {
  const onOverwrite = vi.fn(); const onSaveAs = vi.fn();
  const container = document.createElement("div"); const root = createRoot(container);
  act(() => root.render(<V1MigrationDialog entrypoint="README.md" onOverwrite={onOverwrite}
    onSaveAs={onSaveAs} onCancel={vi.fn()} />));
  expect(container.textContent).toContain("version 2.0");
  expect(container.textContent).toContain("README.md");
  act(() => ([...container.querySelectorAll("button")]
    .find((button) => button.textContent === "Upgrade Original") as HTMLButtonElement).click());
  expect(onOverwrite).toHaveBeenCalledOnce();
  act(() => root.unmount());
});
