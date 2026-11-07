import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { InferredManifestDialog } from "./InferredManifestDialog";

test("reviews and edits an inferred manifest before opening the folder", () => {
  const onConfirm = vi.fn();
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(<InferredManifestDialog
    files={["index.md", "guide.md", "diagrams/flow.puml", "diagrams/flow.svg"]}
    manifest={{ format: "mdpkg", version: "2.0", entrypoint: "index.md", resources: [
      { type: "graphviz", source: "diagrams/flow.puml", rendered: "diagrams/flow.svg" },
    ] }}
    warnings={["index.md: linked file does not exist: missing.png"]}
    onConfirm={onConfirm}
    onCancel={vi.fn()}
  />));

  expect(container.textContent).toContain("manifest.json がありません");
  expect(container.textContent).toContain("missing.png");
  const entrypoint = container.querySelector('select[aria-label="開始ファイル"]') as HTMLSelectElement;
  act(() => { entrypoint.value = "guide.md"; entrypoint.dispatchEvent(new Event("change", { bubbles: true })); });
  const type = container.querySelector('select[aria-label="リソース 1 種類"]') as HTMLSelectElement;
  expect(type.value).toBe("graphviz");
  expect(container.textContent).toContain("未対応のリソース種別");
  expect([...type.options].map((option) => option.value)).toContain("mermaid");
  act(() => (Array.from(container.querySelectorAll("button"))
    .find((button) => button.textContent === "フォルダを開く") as HTMLButtonElement).click());

  expect(onConfirm).toHaveBeenCalledWith({
    format: "mdpkg", version: "2.0", entrypoint: "guide.md", resources: [
      { type: "graphviz", source: "diagrams/flow.puml", rendered: "diagrams/flow.svg" },
    ],
  });
  act(() => root.unmount());
});
