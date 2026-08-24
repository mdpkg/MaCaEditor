import { describe, expect, test, vi } from "vitest";
import { validateDiagramSource } from "./aiDiagramValidation";

describe("validateDiagramSource", () => {
  test.each(["plantuml", "mermaid"] as const)("rejects empty %s source without rendering", async (format) => {
    const render = vi.fn();
    await expect(validateDiagramSource(format, "  \n", render)).rejects.toThrow("empty");
    expect(render).not.toHaveBeenCalled();
  });
  test.each(["plantuml", "mermaid"] as const)("returns rendered SVG for valid %s source", async (format) => {
    const render = vi.fn().mockResolvedValue("<svg>valid</svg>");
    await expect(validateDiagramSource(format, "valid source", render)).resolves.toBe("<svg>valid</svg>");
    expect(render).toHaveBeenCalledWith("valid source");
  });
  test.each(["plantuml", "mermaid"] as const)("keeps %s syntax errors as validation failures", async (format) => {
    const render = vi.fn().mockRejectedValue(new Error("syntax error"));
    await expect(validateDiagramSource(format, "malformed", render)).rejects.toThrow("syntax error");
  });
});
