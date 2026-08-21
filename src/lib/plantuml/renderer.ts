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

export async function renderPlantUml(source: string): Promise<string> {
  await loadVizGlobal();
  const { renderToString } = await import("@plantuml/core");
  return new Promise((resolve, reject) => {
    renderToString(
      source.split(/\r\n|\r|\n/),
      resolve,
      (message) => reject(new Error(message)),
    );
  });
}
