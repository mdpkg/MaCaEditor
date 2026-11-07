import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { ManifestEditorDialog } from "./ManifestEditorDialog";

test("edits entrypoint, description, and resource relationships", () => {
  const onSave = vi.fn(); const container = document.createElement("div"); const root = createRoot(container);
  act(() => root.render(<ManifestEditorDialog manifest={{ entrypoint: "index.md", description: "Old", resources: [] }}
    files={["index.md", "guide.markdown", "notes.txt", "diagrams/a.puml", "diagrams/a.svg"]}
    onSave={onSave} onClose={vi.fn()} />));
  const entrypoint = container.querySelector("select[aria-label='開始ファイル']") as HTMLSelectElement;
  expect(Array.from(entrypoint.options).map((option) => option.value)).toEqual(["index.md", "guide.markdown"]);
  act(() => {
    entrypoint.value = "guide.markdown";
    entrypoint.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const description = container.querySelector("textarea[aria-label='説明']") as HTMLTextAreaElement;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(description, "新規作成");
    description.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => (container.querySelector("button[data-action='add-resource']") as HTMLButtonElement).click());
  const inputs = [...container.querySelectorAll(".manifest-resource-row select, .manifest-resource-row input")] as HTMLInputElement[];
  ["plantuml", "diagrams/a.puml", "diagrams/a.svg"].forEach((value, index) => act(() => {
    const input = inputs[index];
    const select = input instanceof HTMLSelectElement;
    Object.getOwnPropertyDescriptor(select ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event(select ? "change" : "input", { bubbles: true }));
  }));
  act(() => (container.querySelector("button[data-action='save']") as HTMLButtonElement).click());
  expect(onSave).toHaveBeenCalledWith({ entrypoint: "guide.markdown", description: "新規作成", resources: [
    { type: "plantuml", source: "diagrams/a.puml", rendered: "diagrams/a.svg" },
  ] });
  act(() => root.unmount());
});
