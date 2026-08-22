interface Renderer {
  convert: (source: string) => string;
}

let rendererPromise: Promise<Renderer> | null = null;

function loadRenderer(): Promise<Renderer> {
  if (!rendererPromise) {
    rendererPromise = Promise.all([
      import("mathjax-full/js/mathjax.js"),
      import("mathjax-full/js/input/tex.js"),
      import("mathjax-full/js/output/svg.js"),
      import("mathjax-full/js/adaptors/liteAdaptor.js"),
      import("mathjax-full/js/handlers/html.js"),
      import("mathjax-full/js/input/tex/AllPackages.js"),
    ]).then(([mathjaxModule, texModule, svgModule, adaptorModule, handlerModule, packagesModule]) => {
      const adaptor = adaptorModule.liteAdaptor();
      handlerModule.RegisterHTMLHandler(adaptor);
      const mathDocument = mathjaxModule.mathjax.document("", {
        InputJax: new texModule.TeX({ packages: packagesModule.AllPackages }),
        OutputJax: new svgModule.SVG({ fontCache: "local" }),
      });
      return {
        convert(source: string) {
          return adaptor.outerHTML(mathDocument.convert(source, { display: true }));
        },
      };
    });
  }
  return rendererPromise;
}

export async function renderMathJax(source: string): Promise<string> {
  const rendered = (await loadRenderer()).convert(source);
  const parsed = new DOMParser().parseFromString(rendered, "text/html");
  const svg = parsed.querySelector("svg");
  if (!svg) throw new Error("MathJax did not produce an SVG");
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  return new XMLSerializer().serializeToString(svg);
}
