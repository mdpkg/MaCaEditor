import { describe, expect, it } from "vitest";
// @ts-expect-error Node types are intentionally not part of the application build.
import { readFileSync } from "node:fs";
// @ts-expect-error Node types are intentionally not part of the application build.
import { resolve } from "node:path";

declare const process: { cwd(): string };
const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

describe("image sizing styles", () => {
  it.each([".markdown-preview img", ".drawing-image svg", ".binary-view img"])(
    "preserves aspect ratio for %s",
    (selector) => {
      const start = styles.indexOf(`${selector} {`);
      const block = start >= 0 ? styles.slice(start, styles.indexOf("}", start)) : "";
      expect(block).toContain("max-width: 100%");
      expect(block).toContain("max-height: 70vh");
      expect(block).toContain("width: auto");
      expect(block).toContain("height: auto");
      expect(block).toContain("object-fit: contain");
    },
  );
});
