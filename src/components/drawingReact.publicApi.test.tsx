import { describe, expect, test } from "vitest";
import { DrawingEditor, type DrawingEditorProps } from "@maca/drawing-react";

describe("@maca/drawing-react public API", () => {
  test("exports the editor component with its typed integration contract", () => {
    const component: (props: DrawingEditorProps) => unknown = DrawingEditor;

    expect(component).toBeTypeOf("function");
  });
});
