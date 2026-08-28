/**
 * Accepts browser-safe image sources supported by drawing documents.
 * This intentionally has no DOM or MaCa Editor dependency.
 */
export function sanitizeImageSrc(src: string): string {
  if (!src) return "";
  const trimmed = src.trim();
  if (!trimmed) return "";

  try {
    const url = new URL(trimmed);
    if (/^https?:$/.test(url.protocol) && /^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }
    if (/^data:image\//i.test(trimmed)) {
      const commaIndex = trimmed.indexOf(",");
      const hasContent = commaIndex >= 0 && trimmed.slice(commaIndex + 1).length > 0;
      const hasType = /^data:image\/[^/]+/i.test(trimmed);
      if (hasType && hasContent) return trimmed;
    }
  } catch {
    // Invalid URLs are rejected below.
  }
  return "";
}
