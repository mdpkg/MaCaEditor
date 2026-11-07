export interface ShortcutEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey?: boolean;
}

export function isSaveShortcut(event: ShortcutEvent): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "s";
}

export function isPackageSearchShortcut(event: ShortcutEvent): boolean {
  return isSearchKey(event) && event.shiftKey === true;
}

export function isDocumentSearchShortcut(event: ShortcutEvent): boolean {
  return isSearchKey(event) && !event.shiftKey;
}

function isSearchKey(event: ShortcutEvent): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "f";
}
