/**
 * Markdown 内の raw HTML から危険な要素を取り除く。
 * 任意 JavaScript の実行を防ぐ。
 */
export function sanitizeHtml(html: string): string {
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
