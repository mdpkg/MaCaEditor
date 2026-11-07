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

export async function preparePaginatedPrint(preview: HTMLElement, title: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText = "position: fixed; top: 0; left: -10000px; width: 210mm; height: 297mm; border: 0";
  document.body.append(frame);
  try {
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
    return { target, dispose: () => frame.remove() };
  } catch (error) {
    frame.remove();
    throw error;
  }
}
