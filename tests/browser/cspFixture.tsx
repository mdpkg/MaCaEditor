export { mount, actions } from "./marpFixture";
export { renderPlantUml } from "../../src/lib/plantuml/renderer";
export { renderMermaid } from "../../src/lib/mermaid/renderer";
export { renderMathJax } from "../../src/lib/mathjax/renderer";
import { preparePaginatedPrint } from "../../src/lib/preparePaginatedPrint";

export async function paginate() {
  const preview = document.createElement("section");
  preview.innerHTML = "<h1>Print compatibility</h1><p>Local print content</p>";
  document.body.append(preview);
  const dispose = await preparePaginatedPrint(preview, "CSP print test");
  const pages = document.querySelectorAll(".maca-print-pages .pm-page").length;
  dispose();
  preview.remove();
  return pages;
}
