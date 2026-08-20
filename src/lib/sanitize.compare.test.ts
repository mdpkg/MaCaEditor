import { describe, expect, test } from "vitest";
import { sanitizeHtml } from "./sanitize";
import { renderSvg } from "./drawing/svg";
import type { DrawingDocument } from "./drawing/model";

function doc(objects: DrawingDocument["objects"]): DrawingDocument {
  return {
    format: "maca-drawing",
    version: "1.0",
    canvas: { width: 1200, height: 800, gridSize: 10 },
    objects,
  };
}

/** サンプル SVG（期待される出力そのもの）。 */
function sampleSvg(): string {
  return renderSvg(
    doc([
      {
        id: "r1",
        type: "rectangle",
        x: 100,
        y: 100,
        width: 200,
        height: 80,
        rotation: 0,
        zIndex: 1,
        style: { fill: "#fff", stroke: "#000", strokeWidth: 1 },
        text: "API",
      },
    ]),
  );
}

/**
 * サニタイズ出力と期待出力を厳密に比較する。
 * 唯一の既知の差異（自己閉じタグの展開）を正規化してから比較する。
 */
function normalizeSelfClosing(svg: string): string {
  // 自己閉じタグを `<tag attrs></tag>` の形に統一する。
  // 1. `<tag ... />` → `<tag ...></tag>`（末尾スペースを除去）
  // 2. `<tag ... ></tag>` → `<tag ...></tag>`（閉じタグ前のスペースを除去）
  return svg
    .replace(/<([a-zA-Z][a-zA-Z0-9]*)([^>]*?)\s*\/>/g, "<$1$2></$1>")
    .replace(/<([a-zA-Z][a-zA-Z0-9]*)([^>]*?)\s*><\/\1>/g, "<$1$2></$1>");
}

describe("sanitizeHtml SVG: definitive root-cause comparison", () => {
  test("sanitized output equals expected SVG after self-closing normalization", () => {
    const expected = sampleSvg();
    const actual = sanitizeHtml(expected);

    // 決定的比較: 自己閉じタグの展開差異を除けば完全一致するはず
    expect(normalizeSelfClosing(actual)).toBe(normalizeSelfClosing(expected));
  });

  test("namespace is preserved (root cause is NOT namespace loss)", () => {
    const expected = sampleSvg();
    const actual = sanitizeHtml(expected);

    // ルートの xmlns が保持されている
    expect(actual).toContain('xmlns="http://www.w3.org/2000/svg"');
    // 期待出力と同じ xmlns を持つ
    expect(actual.match(/xmlns="[^"]*"/)?.[0]).toBe(
      expected.match(/xmlns="[^"]*"/)?.[0],
    );
  });

  test("all elements and attributes are preserved", () => {
    const expected = sampleSvg();
    const actual = sanitizeHtml(expected);

    // 全要素タグが残っている
    for (const tag of ["svg", "defs", "marker", "polygon", "rect", "text"]) {
      expect(actual).toContain(`<${tag}`);
      expect(actual).toContain(`</${tag}>`);
    }

    // 全属性が残っている
    for (const attr of [
      'width="1200"',
      'height="800"',
      'viewBox="0 0 1200 800"',
      'id="arrowhead"',
      'points="0 0, 10 3, 0 6"',
      'fill="#fff"',
      'stroke="#000"',
      'stroke-width="1"',
      'x="200"',
      'y="140"',
      'text-anchor="middle"',
      "API",
    ]) {
      expect(actual).toContain(attr);
    }
  });

  test("only difference is self-closing tag expansion", () => {
    const expected = sampleSvg();
    const actual = sanitizeHtml(expected);

    // 自己閉じタグの展開差異を除いた後の、残りの差異を列挙する
    const expectedNorm = normalizeSelfClosing(expected);
    const actualNorm = normalizeSelfClosing(actual);

    // 完全一致 → 差異は自己閉じタグの展開のみ
    expect(actualNorm).toBe(expectedNorm);
  });
});
