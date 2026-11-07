import type { polyfill } from "@humanwhocodes/paged-media";
import pagedMediaUrl from "@humanwhocodes/paged-media/browser.min?url";
import printStyles from "../styles.css?inline";

const pageLimit = 5000;

type PrintWindow = Window & {
  PagedMediaConfig?: { auto: boolean };
  PagedMedia?: { polyfill: typeof polyfill };
};

function loadPaginator(target: PrintWindow): Promise<void> {
  target.PagedMediaConfig = { auto: false };
  const script = target.document.createElement("script");
  script.src = pagedMediaUrl;
  return new Promise((resolve, reject) => {
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load the print paginator"));
    target.document.head.append(script);
  });
}

function mountPrintPages(printDoc: Document): () => void {
  const prepared = printDoc.querySelector<HTMLElement>(".pm-pages");
  if (!prepared) throw new Error("Could not find the paginated print pages");

  const pages = document.importNode(prepared, true);
  pages.hidden = true;
  pages.classList.add("maca-print-pages");
  const stylesheet = document.createElement("style");
  stylesheet.media = "print";
  const paginatorStyles = Array.from(
    printDoc.head.querySelectorAll("style[data-pm-styles]"),
    (style) => style.textContent,
  ).join("\n");
  stylesheet.textContent = `
    ${paginatorStyles}
    @page { size: A4; margin: 0; }
    body > :not(.maca-print-pages) { display: none !important; }
    body > .maca-print-pages { display: block !important; }
    /* Leave vertical clearance for print rounding while keeping the sheet width. */
    .maca-print-pages .pm-page {
      max-height: calc(297mm - 4px);
    }
  `;
  document.head.append(stylesheet);
  document.body.append(pages);
  return () => {
    pages.remove();
    stylesheet.remove();
  };
}

export async function preparePaginatedPrint(preview: HTMLElement, title: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText = "position: fixed; top: 0; left: -10000px; width: 210mm; height: 297mm; border: 0";
  // Match the main document's standards mode when measuring table rows and text.
  frame.srcdoc = "<!doctype html><html><head></head><body></body></html>";
  try {
    await new Promise<void>((resolve) => {
      frame.addEventListener("load", () => resolve(), { once: true });
      document.body.append(frame);
    });
    const target = frame.contentWindow as PrintWindow | null;
    if (!target) throw new Error("Could not open the print document");
    const printDoc = target.document;
    printDoc.title = title;
    printDoc.documentElement.lang = document.documentElement.lang;
    const header = JSON.stringify(title.replace(/[\u0000-\u001f\u007f]/g, " "));
    const style = printDoc.createElement("style");
    // Use a literal here because the paginator does not resolve var() in margin content.
    style.textContent = `${printStyles}\n@page { @top-left { content: ${header}; } }`;
    printDoc.head.append(style);

    const copy = printDoc.importNode(preview, true);
    const images = Array.from(copy.querySelectorAll("img"));
    for (const image of images) image.loading = "eager";
    printDoc.body.append(copy);
    await Promise.all([loadPaginator(target), ...images.map((image) => image.decode().catch(() => {}))]);
    const result = await target.PagedMedia?.polyfill({ defaultPageSize: "A4", force: true, maxPages: pageLimit });
    if (!result?.pageCount) throw new Error("Could not paginate the print document");
    if (result.pageCount >= pageLimit) throw new Error("The print document reached the pagination limit");
    // WebKitGTK prints the top-level document even if print() is called in a frame.
    return mountPrintPages(printDoc);
  } finally {
    frame.remove();
  }
}
