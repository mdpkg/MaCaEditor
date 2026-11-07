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
  for (const page of Array.from(pages.children)) {
    const sheet = document.createElement("div");
    sheet.className = "maca-print-sheet";
    page.replaceWith(sheet);
    sheet.append(page);
  }
  const stylesheet = document.createElement("style");
  stylesheet.media = "print";
  const paginatorStyles = Array.from(
    printDoc.head.querySelectorAll("style[data-pm-styles]"),
    (style) => style.textContent,
  ).join("\n");
  stylesheet.textContent = `
    ${paginatorStyles}
    @page { margin: 0; }
    body > :not(.maca-print-pages) { display: none !important; }
    body > .maca-print-pages { display: block !important; }
    .maca-print-pages {
      --maca-print-scale: 1;
    }
    @supports (transform: scale(calc(1px / 1px))) {
      .maca-print-pages {
        --maca-print-scale: min(1, calc((100vw - 4px) / 210mm), calc((100vh - 4px) / 297mm));
      }
    }
    .maca-print-sheet {
      position: relative;
      overflow: hidden;
      margin-inline: auto;
      width: calc(210mm * var(--maca-print-scale));
      /* Leave vertical clearance for rounding in the print engine. */
      height: calc((297mm - 4px) * var(--maca-print-scale));
      break-after: page;
    }
    .maca-print-sheet:last-child {
      break-after: auto;
    }
    .maca-print-pages .pm-page {
      position: absolute;
      inset: 0 auto auto 0;
      break-after: auto;
      transform: scale(var(--maca-print-scale));
      transform-origin: top left;
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
