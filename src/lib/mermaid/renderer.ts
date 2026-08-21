let initialized = false;
let renderSequence = 0;

export async function renderMermaid(source: string): Promise<string> {
  const { default: mermaid } = await import("mermaid");
  if (!initialized) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
    });
    initialized = true;
  }
  renderSequence += 1;
  const { svg } = await mermaid.render(`maca-mermaid-${renderSequence}`, source);
  return svg;
}
