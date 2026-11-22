import { Marp } from "@marp-team/marp-core";
import createDOMPurify from "dompurify";
import type MarkdownIt from "markdown-it";
import type { FileInfo } from "../../types";
import type { SlideSourceMap } from "./position";
import { connectMarpResources } from "./resources";

export interface MarpResult {
  html: string;
  css: string;
  slides: SlideSourceMap[];
  warnings: string[];
}

const purifier = createDOMPurify(window);

class PreviewMarp extends Marp {
  selectedTheme?: string;
  protected renderStyle(theme?: string): string {
    return super.renderStyle(this.selectedTheme ?? theme);
  }
}

export function renderMarp(markdown: string, baseDir: string, files: FileInfo[]): MarpResult {
  if (markdown.length > 1024 * 1024) throw new Error("Marp 文書の上限は 1 MiB です。");
  const warnings = new Set<string>();
  const marp = new PreviewMarp({
    html: false, script: false, math: "mathjax", looseYAML: false,
    emoji: { unicode: false, shortcode: false },
    container: false, printable: false,
  });
  const starts: number[] = [];
  const hasTheme = marp.themeSet.has.bind(marp.themeSet);
  marp.themeSet.has = (name: string) => {
    const known = hasTheme(name);
    marp.selectedTheme = known ? name : "default";
    if (!known) warnings.add(`未知のテーマ ${name}: default を使用します。`);
    return known;
  };
  const lineOffsets = [0];
  for (const match of markdown.matchAll(/\r\n|\r|\n/g)) lineOffsets.push(match.index! + match[0].length);
  marp.use((md: MarkdownIt) => {
    // Document styles are parsed by Marpit even with html:false. Keep its parser
    // (so source maps stay correct), but never apply those styles to the theme.
    md.core.ruler.disable(["marpit_style_assign", "marp_math_directive"]);
    md.core.ruler.before("marpit_header_and_footer", "maca_directive_limits", (state) => {
      if (state.tokens.filter((token) => token.type === "marpit_slide_open").length > 500) throw new Error("スライド数の上限は 500 枚です。");
      for (const token of state.tokens) {
        if (token.attrs?.some(([, value]) => value.length > 8192)) throw new Error("ディレクティブ・画像参照の値は 8192 文字以内にしてください。");
      }
    });
    md.core.ruler.push("maca_slide_sources", (state) => {
      for (const token of state.tokens) {
        // The single Marpit token contract used here is covered by source-map tests.
        if (token.type === "marpit_slide_open") starts.push(lineOffsets[token.map?.[0] ?? 0] ?? 0);
        if (token.type === "marpit_style" || token.attrGet("data-style")) warnings.add("文書内 style はプレビューに適用しません。");
        if (token.attrGet("data-math") === "katex") warnings.add("数式はオフラインの MathJax SVG で表示します。");
        if (token.type === "fence" && token.info.trim().toLowerCase() === "mermaid") warnings.add("Mermaid ブロックの直接描画は未対応です。パッケージ内 SVG を参照してください。");
        const theme = token.attrGet("data-theme");
        if (theme && !["default", "gaia", "uncover"].includes(theme)) warnings.add(`未知のテーマ ${theme}: default を使用します。`);
      }
    });
  });
  const result = marp.render(markdown, { htmlAsArray: true });
  if (result.html.length > 500 || starts.length !== result.html.length) throw new Error("スライド数の上限（500）または原文位置対応を確認してください。");
  starts[0] = 0;
  const slides = starts.map((startOffset, slideIndex) => ({ slideIndex, startOffset, endOffset: starts[slideIndex + 1] ?? markdown.length }));
  const html = result.html.map((slide, index) => `<article data-slide-index="${index}">${purifier.sanitize(slide, {
    ADD_TAGS: ["foreignObject", "mjx-container"],
    HTML_INTEGRATION_POINTS: { foreignobject: true },
    ADD_ATTR: ["xmlns", "xmlns:xlink"],
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "link", "meta", "base", "form"],
    FORBID_ATTR: ["srcdoc", "srcset", "target", "download"],
  })}</article>`).join("");
  const connected = connectMarpResources(html, result.css, baseDir, files, warnings);
  if (connected.html.length + connected.css.length > 32 * 1024 * 1024) throw new Error("プレビューの上限（32 MiB）を超えました。");
  return { ...connected, slides, warnings: [...warnings] };
}
