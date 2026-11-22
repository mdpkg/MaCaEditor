import { generate, parse, walk, type CssNode, type List, type ListItem } from "css-tree";
import type { FileInfo } from "../../types";
import { resolvePackagePath } from "../markdown";
import { imageMediaType } from "../document";
import { sanitizeHtml } from "../sanitize";
import { allowedLink } from "./frame";

function encodeSvg(svg: string): string {
  const bytes = new TextEncoder().encode(svg);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 32768) binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

function rasterMatches(path: string, base64: string): boolean {
  if (!/^[a-z\d+/]*={0,2}$/i.test(base64) || base64.length % 4 !== 0) return false;
  const head = atob(base64.slice(0, 32));
  switch (imageMediaType(path)) {
    case "image/png": return head.startsWith("\x89PNG\r\n\x1a\n");
    case "image/jpeg": return head.startsWith("\xff\xd8\xff");
    case "image/gif": return head.startsWith("GIF87a") || head.startsWith("GIF89a");
    case "image/webp": return head.startsWith("RIFF") && head.slice(8, 12) === "WEBP";
    case "image/bmp": return head.startsWith("BM");
    default: return false;
  }
}

/** Connect generated URLs to existing package files; not a general CSS sanitizer.
 * Only official theme CSS reaches this function. Document styles are disabled.
 * CSP is the final network boundary, including unsupported CSS URL syntax.
 */
export function connectMarpResources(html: string, css: string, baseDir: string, files: FileInfo[], warnings: Set<string>): { html: string; css: string } {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const resolved = new Map<string, string>();
  let used = 0;
  const image = (url: string): string => {
    if (resolved.has(url)) return resolved.get(url)!;
    let data = "";
    try {
      const target = decodeURIComponent(url);
      if (/[\u0000-\u001f\u007f]/.test(target)) throw new Error("Invalid path");
      const path = resolvePackagePath(baseDir, target);
      const file = path ? byPath.get(path) : undefined;
      if (!file || !/\.(svg|png|jpe?g|gif|webp|bmp)$/i.test(file.path)) throw new Error("Missing image");
      if ((file.content?.length ?? file.base64?.length ?? 0) > 8 * 1024 * 1024) throw new Error("Image too large");
      if (/\.svg$/i.test(file.path)) {
        const source = file.content ?? new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(file.base64 ?? ""), (char) => char.charCodeAt(0)));
        const svg = new DOMParser().parseFromString(sanitizeHtml(source), "image/svg+xml");
        if (svg.querySelector("parsererror") || svg.documentElement.localName !== "svg") throw new Error("Invalid SVG");
        for (const node of svg.querySelectorAll("*")) {
          for (const attribute of [...node.attributes]) {
            if (["href", "xlink:href", "src"].includes(attribute.name) && !attribute.value.startsWith("#")) {
              // Preserve only embedded raster images that pass the same byte check.
              const match = /^data:image\/(png|jpeg|gif|webp|bmp);base64,(.+)$/.exec(attribute.value);
              if (!match || !rasterMatches(`image.${match[1]}`, match[2])) node.removeAttributeNode(attribute);
            }
          }
        }
        data = encodeSvg(new XMLSerializer().serializeToString(svg));
      } else if (file.base64 && rasterMatches(file.path, file.base64)) {
        data = `data:${imageMediaType(file.path)};base64,${file.base64}`;
      } else throw new Error("Invalid image bytes");
      used += data.length;
      if (used > 24 * 1024 * 1024) throw new Error("Resource budget exceeded");
    } catch {
      warnings.add(`画像を読み込めません（不足・禁止された参照・形式・容量）: ${url.slice(0, 200)}`);
      data = "";
    }
    resolved.set(url, data);
    return data;
  };
  const rewriteCss = (value: string, context: "stylesheet" | "declarationList") => {
    try {
      const tree = parse(value, { context, parseCustomProperty: true });
      walk(tree, {
        enter(node: CssNode, item: ListItem<CssNode>, list: List<CssNode>) {
          if (node.type === "Atrule" && ["import", "font-face"].includes(node.name.toLowerCase()) && item && list) { list.remove(item); return walk.skip; }
          if (node.type === "Declaration") {
            let raw = false;
            walk(node.value, (child) => { if (child.type === "Raw") raw = true; });
            if (raw && item && list) { list.remove(item); return walk.skip; }
          }
          // Bundled themes include fixed data-URL icons. No document stylesheet
          // reaches this branch; inline document values always use image().
          if (node.type === "Url" && !node.value.startsWith("#") && !(context === "stylesheet" && node.value.startsWith("data:image/"))) node.value = image(node.value);
        },
      });
      return generate(tree);
    } catch {
      warnings.add("画像参照を含む未対応の CSS 値を無効化しました。");
      return "";
    }
  };
  const document = new DOMParser().parseFromString(html, "text/html");
  for (const node of document.body.querySelectorAll("*")) {
    for (const attribute of [...node.attributes]) {
      if (attribute.name.startsWith("data-") && !attribute.name.startsWith("data-marpit") && !["data-slide-index", "data-paginate"].includes(attribute.name)) node.removeAttributeNode(attribute);
    }
    if (node.hasAttribute("style")) node.setAttribute("style", rewriteCss(node.getAttribute("style")!, "declarationList"));
    for (const name of ["src", "href", "xlink:href"]) {
      const url = node.getAttribute(name);
      if (url === null) continue;
      if (node.localName === "a" && name === "href") {
        if (!allowedLink(url)) node.removeAttribute(name);
      } else if (!url.startsWith("#")) {
        const data = image(url);
        if (data) node.setAttribute(name, data);
        else node.removeAttribute(name);
      }
    }
  }
  return { html: document.body.innerHTML, css: rewriteCss(css, "stylesheet") };
}
