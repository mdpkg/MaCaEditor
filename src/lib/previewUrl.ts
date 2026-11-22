import { defaultUrlTransform } from "react-markdown";
import { resolvePackagePath } from "./markdown";

const externalProtocols = new Set(["http:", "https:", "mailto:"]);
const blocked = { href: "#", path: null };

/** Resolve once: decode a package path, validate it, then encode it for the DOM.
 * Callers must use path for file lookup and href for navigation, without decoding
 * or resolving either again. Queries/fragments are not part of a package filename.
 */
export function resolvePreviewLink(baseDir: string, url: string): { href: string; path: string | null } {
  if (!url || url.trim() !== url || /[\u0000-\u001f\u007f]/.test(url)) return blocked;
  if (url.startsWith("#")) return { href: url, path: null };
  if (/^[a-z][a-z\d+.-]*:/i.test(url)) {
    try {
      const parsed = new URL(url);
      if (!externalProtocols.has(parsed.protocol) || defaultUrlTransform(url) !== url) return blocked;
      if (parsed.protocol !== "mailto:" && !/^https?:\/\//i.test(url)) return blocked;
      return { href: url, path: null };
    } catch { return blocked; }
  }
  const boundary = url.search(/[?#]/);
  const rawPath = boundary < 0 ? url : url.slice(0, boundary);
  const suffix = boundary < 0 ? "" : url.slice(boundary);
  let target: string;
  try { target = decodeURIComponent(rawPath); } catch { return blocked; }
  // Residual escapes are ambiguous if another consumer decodes them later.
  if (target.trim() !== target || /[\u0000-\u001f\u007f]|%[a-f\d]{2}/i.test(target)) return blocked;
  if (defaultUrlTransform(target) !== target) return blocked;
  if (!target) return { href: suffix || "#", path: null };
  const path = resolvePackagePath(baseDir, target);
  if (!path) return blocked;
  // Encoding each segment also prevents special characters in filenames from
  // becoming a new scheme, query, fragment or percent escape in the browser.
  return { href: path.split("/").map(encodeURIComponent).join("/") + suffix, path };
}
