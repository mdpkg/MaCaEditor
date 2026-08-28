/**
 * Markdown 内の raw HTML から危険な要素を取り除く。
 * 任意 JavaScript の実行を防ぐ。
 */
export function sanitizeHtml(html: string): string {
  // SVG は image/svg+xml としてパースして名前空間を保持する。
  // text/html でパースすると SVG 要素が HTML 名前空間に入り、描画されなくなるため。
  const trimmed = html.trim();
  const isSvg = /^<svg[\s>]/.test(trimmed);
  if (isSvg) {
    const doc = new DOMParser().parseFromString(trimmed, "image/svg+xml");

    // パースエラー（parsererror）が返った場合は空文字にする
    if (doc.querySelector("parsererror")) return "";

    // 危険な要素を削除
    const dangerousTags = ["script", "foreignobject", "iframe", "object", "embed"];
    for (const tag of dangerousTags) {
      doc.querySelectorAll(tag).forEach((el) => el.remove());
    }

    // 危険な属性を削除
    const dangerousAttrs = [/^on/i, /^javascript:/i];
    for (const el of Array.from(doc.querySelectorAll("*"))) {
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name;
        const value = attr.value;
        if (dangerousAttrs.some((re) => re.test(name) || re.test(value))) {
          el.removeAttribute(name);
        }
      }
    }

    return doc.documentElement.outerHTML;
  }

  const doc = new DOMParser().parseFromString(html, "text/html");

  // 危険な要素を削除
  const dangerousTags = ["script", "iframe", "object", "embed"];
  for (const tag of dangerousTags) {
    doc.body.querySelectorAll(tag).forEach((el) => el.remove());
  }

  // 危険な属性を削除
  const dangerousAttrs = [
    /^on/i, // event handler attributes
    /^javascript:/i,
  ];
  for (const el of Array.from(doc.body.querySelectorAll("*"))) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name;
      const value = attr.value;
      if (dangerousAttrs.some((re) => re.test(name) || re.test(value))) {
        el.removeAttribute(name);
      }
    }
  }

  return doc.body.innerHTML;
}

// Backward-compatible application export. The implementation belongs to the
// framework-independent drawing package.
export { sanitizeImageSrc } from "@maca/drawing-core";
