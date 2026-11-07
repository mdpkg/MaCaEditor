import vizGlobalUrl from "@plantuml/core/viz-global.js?url";

let vizReady: Promise<void> | null = null;

function loadVizGlobal(): Promise<void> {
  if (vizReady) return vizReady;
  vizReady = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-plantuml-viz]");
    if (existing?.dataset.loaded === "true") {
      resolve();
      return;
    }
    const script = existing ?? document.createElement("script");
    script.dataset.plantumlViz = "true";
    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      resolve();
    }, { once: true });
    script.addEventListener("error", () => reject(new Error("Unable to load PlantUML layout engine")), { once: true });
    if (!existing) {
      script.src = vizGlobalUrl;
      document.head.appendChild(script);
    }
  });
  return vizReady;
}

export function plantUmlErrorDetail(svg: string): string | null {
  if (!svg) return null;
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  const lines = Array.from(document.querySelectorAll("svg > g > text"), (node) => node.textContent ?? "");
  // The TeaVM renderer returns its diagnostic SVG through the success callback.
  const syntaxError = lines[0]?.startsWith("PlantUML version ") &&
    lines.some((line) => /^\[From .+ \(line \d+\) *\]$/.test(line));
  const unsupported = lines[0] === "Diagram not supported by this release of PlantUML" &&
    lines.includes("Possible causes:");
  return syntaxError || unsupported ? lines.join("\n") : null;
}

export async function renderPlantUml(source: string): Promise<string> {
  await loadVizGlobal();
  const { renderToString } = await import("@plantuml/core");
  const svg = await new Promise<string>((resolve, reject) => {
    renderToString(
      source.split(/\r\n|\r|\n/),
      resolve,
      (message) => reject(new Error(message)),
    );
  });
  const detail = plantUmlErrorDetail(svg);
  if (detail) throw new Error(detail);
  return svg;
}
