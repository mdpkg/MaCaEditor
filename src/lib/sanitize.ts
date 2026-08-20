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

/**
 * 画像オブジェクトの src を検証・サニタイズする。
 * data:image のみ許可し、それ以外（javascript: 等）は空文字に置き換える。
 */
export function sanitizeImageSrc(src: string): string {
  if (!src || src.length === 0) return "";
  const trimmed = src.trim();
  if (trimmed.length === 0) return "";
  try {
    const url = new URL(trimmed);
    // 許可するスキーム: http, https（スラッシュなしの http: 形式は拒否）
    if (/^https?:$/.test(url.protocol) && /^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }
    // data:image は URL パース可能かつ実データを持つ場合のみ許可
    if (/^data:image\//i.test(trimmed)) {
      // "data:image/..." の後ろに実データ（MIME 指定後のコンテンツ）が存在するか
      const dataUrl = trimmed;
      const commaIndex = dataUrl.indexOf(",");
      const hasContent = commaIndex >= 0 && dataUrl.slice(commaIndex + 1).length > 0;
      // プレフィックスのみ（data:image/）は拒否
      const hasType = /^data:image\/[^/]+/i.test(dataUrl);
      if (hasType && hasContent) return trimmed;
    }
    return "";
  } catch {
    // 不正な URL（ホストなし・空白含む等）は拒否
    return "";
  }
}
