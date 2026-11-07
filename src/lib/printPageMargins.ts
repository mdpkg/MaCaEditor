export function supportsPrintPageMargins(): boolean {
  const style = document.createElement("style");
  style.textContent = '@page { @top-left { content: "MaCa"; } @bottom-center { content: counter(page) " / " counter(pages); } }';
  document.head.append(style);
  try {
    const css = style.sheet?.cssRules[0]?.cssText ?? "";
    return css.includes("@top-left") && css.includes("counter(page)") && css.includes("counter(pages)");
  } finally {
    style.remove();
  }
}
