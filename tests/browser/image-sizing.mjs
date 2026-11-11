import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const stylesheet = fileURLToPath(new URL("../../src/styles.css", import.meta.url));
const containerWidth = 320;
const previews = [
  {
    name: "Markdown image",
    selector: ".markdown-preview img",
    markup: () => `<div class="markdown-preview"><p><img alt="Sample"></p></div>`,
  },
  {
    name: "inline drawing",
    selector: ".drawing-image svg",
    markup: (width, height) => `
      <div class="markdown-preview">
        <span class="drawing-image preview-diagram">
          <span class="preview-diagram-content">
            <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
              <rect width="${width}" height="${height}" />
            </svg>
          </span>
        </span>
      </div>`,
  },
  {
    name: "attachment image",
    selector: ".binary-view img",
    markup: () => `<div class="binary-view"><img alt="Sample"></div>`,
  },
];

// At a viewport height of 400px, the 70vh limit is 280px.
const sizes = [
  { name: "fits the preview width", natural: [640, 160], expected: (width) => [width, width / 4] },
  { name: "fits the viewport height limit", natural: [160, 640], expected: () => [70, 280] },
  { name: "keeps a small image at its intrinsic size", natural: [120, 60], expected: () => [120, 60] },
];

let browser;
before(async () => {
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
});

for (const preview of previews) {
  for (const { name, natural, expected } of sizes) {
    test(`${preview.name} ${name} and preserves its aspect ratio`, async (t) => {
      const page = await browser.newPage({ viewport: { width: 800, height: 400 } });
      t.after(() => page.close());
      await page.setContent(`<!doctype html><main style="width: ${containerWidth}px">${preview.markup(...natural)}</main>`);
      await page.addStyleTag({ path: stylesheet });

      const image = page.locator(preview.selector);
      await image.evaluate(async (element, [width, height]) => {
        if (!(element instanceof HTMLImageElement)) return;
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        element.src = canvas.toDataURL("image/png");
        await element.decode();
      }, natural);

      const box = await image.boundingBox();
      assert.ok(box, "The image is visible");
      const availableWidth = await image.evaluate((element) => element.parentElement.clientWidth);
      assert.ok(availableWidth <= containerWidth, `The preview overflowed its ${containerWidth}px container`);
      const [expectedWidth, expectedHeight] = expected(availableWidth);
      assert.ok(Math.abs(box.width - expectedWidth) <= 1, `Expected width ${expectedWidth}px, got ${box.width}px`);
      assert.ok(Math.abs(box.height - expectedHeight) <= 1, `Expected height ${expectedHeight}px, got ${box.height}px`);
    });
  }
}
