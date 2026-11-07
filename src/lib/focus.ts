import { useLayoutEffect, useRef, type RefObject } from "react";

const focusableSelector = 'button, a[href], input, select, textarea, summary, [tabindex], [contenteditable="true"]';

function focusableElements(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(focusableSelector)].filter((element) => {
    if (element.tabIndex < 0 || element.matches(":disabled")) return false;
    for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (parent.hidden || parent.inert || style.display === "none" || style.visibility === "hidden") return false;
      if (parent.matches("details:not([open])") && element.closest("summary")?.parentElement !== parent) return false;
      if (parent === container) break;
    }
    return true;
  });
}

const dialogs: HTMLElement[] = [];

export function useDialog(
  ref: RefObject<HTMLElement>,
  onClose: () => void,
  layerRef: RefObject<HTMLElement>,
  initialFocus?: RefObject<HTMLElement>,
) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const layer = layerRef.current ?? dialog;
    const previousLayer = dialogs[dialogs.length - 1];
    layer.style.zIndex = String(Number(previousLayer?.style.zIndex ?? 2000) + 1);
    dialogs.push(layer);
    const isTopDialog = () => dialogs[dialogs.length - 1] === layer;
    const focusFirst = () => (initialFocus?.current ?? focusableElements(dialog)[0] ?? dialog).focus();
    if (!dialog.contains(document.activeElement)) focusFirst();

    const keydown = (event: KeyboardEvent) => {
      if (!isTopDialog() || event.defaultPrevented || event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRef.current();
      } else if (event.key === "Tab") {
        const elements = focusableElements(dialog);
        const first = elements[0] ?? dialog;
        const last = elements[elements.length - 1] ?? dialog;
        const active = document.activeElement;
        if (!dialog.contains(active) || active === (event.shiftKey ? first : last)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }
    };
    const focusin = (event: FocusEvent) => {
      if (isTopDialog() && !dialog.contains(event.target as Node)) focusFirst();
    };
    window.addEventListener("keydown", keydown);
    document.addEventListener("focusin", focusin);
    return () => {
      const wasTop = isTopDialog();
      dialogs.splice(dialogs.indexOf(layer), 1);
      window.removeEventListener("keydown", keydown);
      document.removeEventListener("focusin", focusin);
      if (wasTop && previous?.isConnected) previous.focus();
    };
  }, [ref, layerRef, initialFocus]);
}
