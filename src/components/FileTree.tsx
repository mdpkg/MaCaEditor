import { uiText } from "../lib/uiText";
import { Menu } from "./Menu";
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { isTauri } from "@tauri-apps/api/core";
import { File as FileIcon, FileText, Folder, FolderOpen, Image as ImageIcon, Workflow, type LucideIcon } from "lucide-react";
import type { FileInfo } from "../types";
import { buildFileTree, type TreeNode } from "../lib/fileTree";
import { PACKAGE_PATH_DRAG_TYPE, PACKAGE_PATH_POINTER_DROP, type PackagePathPointerDrop } from "../lib/packageDrag";
import { fileTreeIconKind, type FileTreeIconKind } from "../lib/fileTreeIcons";

interface Props {
  files: FileInfo[];
  manifest?: Record<string, unknown>;
  directories?: string[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onSelectFolder?: (path: string) => void;
  collapsedPaths?: Set<string>;
  onCollapsedPathsChange?: (paths: Set<string>) => void;
  onEditMarkdown?: (path: string) => void;
  onDropImages: (files: File[]) => void;
  imageDropDirectory?: string;
  canRename: (path: string) => boolean;
  onRename: (path: string) => void;
  canDelete: (path: string) => boolean;
  onDelete: (path: string) => void;
  canMove?: (path: string) => boolean;
  onMove?: (path: string) => void;
  canSetEntrypoint?: (path: string) => boolean;
  onSetEntrypoint?: (path: string) => void;
  onAddMarkdown?: (contextPath: string) => void;
  onAddFolder?: (contextPath: string) => void;
  onDropPath?: (sourcePath: string, destinationPath: string) => void;
  onShowReferences?: (path: string) => void;
}

const fileIcons: Record<FileTreeIconKind, LucideIcon> = {
  markdown: FileText,
  image: ImageIcon,
  diagram: Workflow,
  other: FileIcon,
};

interface TreePointerDrag {
  id: number;
  row: HTMLElement;
  path: string;
  x: number;
  y: number;
  moved: boolean;
}

function TreeIcon({ kind, open }: { kind: FileTreeIconKind | "folder"; open?: boolean }) {
  const Icon = kind === "folder" ? (open ? FolderOpen : Folder) : fileIcons[kind];
  const label = kind === "folder" ? uiText("Folder") : kind === "markdown" ? "Markdown"
    : kind === "image" ? "画像" : kind === "diagram" ? uiText("Diagram") : uiText("File");
  return <span className="tree-item-icon" data-icon-kind={kind} role="img" aria-label={label}>
    <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
  </span>;
}

export function FileTree({
  files, manifest = {}, directories = [], selectedPath, onSelect, onEditMarkdown, onDropImages, imageDropDirectory = "images",
  canRename, onRename, canDelete, onDelete, canMove = () => false, onMove = () => {},
  canSetEntrypoint = () => false, onSetEntrypoint = () => {},
  onAddMarkdown, onAddFolder,
  onDropPath,
  onShowReferences, onSelectFolder, collapsedPaths, onCollapsedPathsChange,
}: Props) {
  const [contextMenu, setContextMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const selectedRowRef = useRef<HTMLDivElement>(null);
  const [localCollapsed, setLocalCollapsed] = useState(new Set<string>());
  const collapsed = collapsedPaths ?? localCollapsed;
  const setCollapsed = onCollapsedPathsChange ?? setLocalCollapsed;
  const [query, setQuery] = useState("");
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const pointerDrag = useRef<TreePointerDrag | null>(null);
  const suppressClick = useRef(false);
  // Tauri's Windows drop handler accepts Explorer files but replaces WebView2's HTML drop handler.
  const usePointerDrag = isTauri() && /Windows/.test(navigator.userAgent);
  const paths = files.map((f) => f.path);
  const tree = buildFileTree(paths, [...new Set(["images", "attachments", ...directories])]);

  const filter = query.trim().toLocaleLowerCase();
  const matchingPaths = new Set<string>();
  if (filter) {
    for (const path of [...paths, ...directories, "images", "attachments"]) {
      if (!path.toLocaleLowerCase().includes(filter)) continue;
      const parts = path.split("/");
      for (let end = 1; end <= parts.length; end++) matchingPaths.add(parts.slice(0, end).join("/"));
    }
  }

  const visible: Array<{ node: TreeNode; depth: number; parent: string | null; position: number; size: number }> = [];
  const visit = (nodes: TreeNode[], depth: number, parent: string | null) => {
    const filtered = filter ? nodes.filter((node) => matchingPaths.has(node.path)) : nodes;
    filtered.forEach((node, index) => {
      visible.push({ node, depth, parent, position: index + 1, size: filtered.length });
      if (node.isDir && (filter || !collapsed.has(node.path))) visit(node.children, depth + 1, node.path);
    });
  };
  visit(tree, 0, null);
  const selectedVisible = visible.some(({ node }) => node.path === selectedPath);
  const tabPath = visible.some(({ node }) => node.path === focusedPath) ? focusedPath
    : selectedVisible ? selectedPath : visible[0]?.node.path;

  useLayoutEffect(() => {
    selectedRowRef.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [selectedPath, selectedVisible]);

  const toggle = (path: string) => {
    if (filter) return;
    const next = new Set(collapsed);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setCollapsed(next);
  };
  const focusPath = (path: string) => {
    setFocusedPath(path);
    [...treeRef.current!.querySelectorAll<HTMLElement>('[role="treeitem"]')]
      .find((item) => item.dataset.path === path)?.focus();
  };

  useEffect(() => {
    if (!contextMenu) return;
    const close = (event: Event) => {
      if (event.target instanceof Element && event.target.closest(".file-tree-context-menu")) return;
      setContextMenu(null);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
    };
  }, [contextMenu]);

  const hasActions = (path: string) => Boolean(onAddMarkdown || onAddFolder || onShowReferences ||
    canRename(path) || canDelete(path) || canMove(path) || canSetEntrypoint(path));

  const startPointerDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    suppressClick.current = false;
    const target = event.target instanceof Element ? event.target : null;
    const row = target?.closest<HTMLElement>('.tree-item[data-path]');
    if (!target || !row || !event.currentTarget.contains(row)) return;
    const path = row.dataset.path;
    if (!path) return;
    target.setPointerCapture(event.pointerId);
    pointerDrag.current = { id: event.pointerId, row, path, x: event.clientX, y: event.clientY, moved: false };
  };

  const updatePointerDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = pointerDrag.current;
    if (!drag || drag.id !== event.pointerId) return null;
    if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) return null;
    drag.moved = true;
    return drag;
  };

  const treeDropFolder = (tree: HTMLElement, hit: Element | null, source: HTMLElement) => {
    if (!onDropPath || !hit || !tree.contains(hit) || source.contains(hit)) return null;
    return hit.closest<HTMLElement>('.tree-dir[data-path]')?.dataset.path ?? "";
  };

  const clearPointerDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (pointerDrag.current?.id !== event.pointerId) return;
    pointerDrag.current = null;
    setDragOverPath(null);
  };

  const finishPointerDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = updatePointerDrag(event);
    clearPointerDrag(event);
    if (!drag) return;
    suppressClick.current = true;
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const folder = treeDropFolder(event.currentTarget, hit, drag.row);
    if (folder !== null) {
      const name = drag.path.slice(drag.path.lastIndexOf("/") + 1);
      onDropPath?.(drag.path, folder ? `${folder}/${name}` : name);
    } else if (hit && !event.currentTarget.contains(hit)) {
      hit.dispatchEvent(new CustomEvent<PackagePathPointerDrop>(PACKAGE_PATH_POINTER_DROP, {
        bubbles: true,
        detail: { path: drag.path, x: event.clientX, y: event.clientY },
      }));
    }
  };

  return (
    <div className={`file-tree${usePointerDrag ? " file-tree-pointer-drag" : ""}${dragOverPath === "" ? " file-tree-drop-root" : ""}`}
      onPointerDown={usePointerDrag ? startPointerDrag : undefined}
      onPointerMove={usePointerDrag ? (event) => {
        const drag = updatePointerDrag(event);
        if (!drag) return;
        setDragOverPath(treeDropFolder(event.currentTarget, document.elementFromPoint(event.clientX, event.clientY), drag.row));
      } : undefined}
      onPointerUp={usePointerDrag ? finishPointerDrag : undefined}
      onPointerCancel={usePointerDrag ? clearPointerDrag : undefined}
      onLostPointerCapture={usePointerDrag ? clearPointerDrag : undefined}
      onClickCapture={usePointerDrag ? (event) => {
        if (!suppressClick.current || event.detail === 0) return;
        suppressClick.current = false;
        event.stopPropagation();
        event.preventDefault();
      } : undefined}
      onDragOver={(event) => { if (onDropPath) event.preventDefault(); }}
      onDrop={(event) => {
        const sourcePath = event.dataTransfer.getData(PACKAGE_PATH_DRAG_TYPE);
        if (!sourcePath || !onDropPath) return;
        event.preventDefault();
        const name = sourcePath.slice(sourcePath.lastIndexOf("/") + 1);
        onDropPath(sourcePath, name);
      }}
    >
      <label className="tree-filter">
        <span>{uiText("Filter files")}</span>
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <div ref={treeRef} role="tree" aria-label={uiText("Package files")}>
      {visible.length === 0 && <p>{uiText("No matching files.")}</p>}
      {visible.map(({ node, depth, parent, position, size }, index) => (
        <div key={node.path} role="treeitem" aria-label={node.name}
          ref={node.path === selectedPath ? selectedRowRef : undefined}
          aria-level={depth + 1} aria-posinset={position} aria-setsize={size}
          aria-expanded={node.isDir ? Boolean(filter) || !collapsed.has(node.path) : undefined}
          aria-selected={node.path === selectedPath} data-path={node.path}
          tabIndex={node.path === tabPath ? 0 : -1}
          className={`tree-item ${node.isDir ? "tree-dir" : ""} ${node.path === selectedPath ? "selected" : ""} ${dragOverPath === node.path ? "drop-target" : ""}`}
          style={{ paddingLeft: depth * 12 + 8 }}
          onFocus={() => setFocusedPath(node.path)}
          onClick={(event) => {
            event.currentTarget.focus();
            if (node.isDir) onSelectFolder?.(node.path);
            else onSelect(node.path);
          }}
          onDoubleClick={() => {
            if (node.isDir) toggle(node.path);
            if (!node.isDir && /\.(md|markdown)$/i.test(node.path)) {
              onSelect(node.path);
              onEditMarkdown?.(node.path);
            }
          }}
          onKeyDown={(event) => {
            if (event.altKey || event.ctrlKey || event.metaKey) return;
            if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
              if (!hasActions(node.path)) return;
              event.preventDefault();
              const rect = event.currentTarget.getBoundingClientRect();
              setContextMenu({ path: node.path, x: rect.left, y: rect.bottom });
              return;
            }
            if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End", "Enter", " "].includes(event.key)) return;
            event.preventDefault();
            if (event.key === "ArrowDown") focusPath(visible[Math.min(index + 1, visible.length - 1)].node.path);
            else if (event.key === "ArrowUp") focusPath(visible[Math.max(index - 1, 0)].node.path);
            else if (event.key === "Home") focusPath(visible[0].node.path);
            else if (event.key === "End") focusPath(visible[visible.length - 1].node.path);
            else if (event.key === "ArrowRight") {
              if (node.isDir && !filter && collapsed.has(node.path)) toggle(node.path);
              else if (visible[index + 1]?.parent === node.path) focusPath(visible[index + 1].node.path);
            } else if (event.key === "ArrowLeft") {
              if (node.isDir && !filter && !collapsed.has(node.path)) toggle(node.path);
              else if (parent) focusPath(parent);
            } else if (node.isDir) onSelectFolder?.(node.path);
            else onSelect(node.path);
          }}
          onContextMenu={(event) => {
            if (!hasActions(node.path)) return;
            event.preventDefault();
            event.currentTarget.focus();
            if (node.isDir) onSelectFolder?.(node.path);
            setContextMenu({ path: node.path, x: event.clientX, y: event.clientY });
          }}
          draggable={!usePointerDrag}
          onDragStart={(event) => {
            event.stopPropagation();
            event.dataTransfer.effectAllowed = "copyMove";
            event.dataTransfer.setData(PACKAGE_PATH_DRAG_TYPE, node.path);
          }}
          onDragOver={(event) => {
            if (!node.isDir || (!onDropPath && node.path !== imageDropDirectory)) return;
            event.preventDefault();
            event.stopPropagation();
            const internal = Array.from(event.dataTransfer.types).includes(PACKAGE_PATH_DRAG_TYPE);
            const items = Array.from(event.dataTransfer.items ?? []);
            const image = items.some((item) => /^image\/(png|jpeg|gif|webp|bmp|x-ms-bmp)$/i.test(item.type));
            event.dataTransfer.dropEffect = internal ? "move" : node.path === imageDropDirectory && (image || items.length === 0) ? "copy" : "none";
            if (event.dataTransfer.dropEffect === "none") return;
            setDragOverPath(node.path);
          }}
          onDragLeave={() => setDragOverPath(null)}
          onDrop={(event) => {
            if (!node.isDir) return;
            const sourcePath = event.dataTransfer.getData(PACKAGE_PATH_DRAG_TYPE);
            if (sourcePath && onDropPath) {
              event.preventDefault();
              event.stopPropagation();
              setDragOverPath(null);
              onDropPath(sourcePath, `${node.path}/${sourcePath.slice(sourcePath.lastIndexOf("/") + 1)}`);
            } else if (node.path === imageDropDirectory) {
              event.preventDefault();
              event.stopPropagation();
              setDragOverPath(null);
              onDropImages(Array.from(event.dataTransfer.files));
            }
          }}>
          {node.isDir && <span className="tree-item-disclosure" aria-hidden="true"
            onClick={(event) => { event.stopPropagation(); event.currentTarget.parentElement?.focus(); toggle(node.path); }}>
            {!filter && collapsed.has(node.path) ? "▸ " : "▾ "}
          </span>}
          <TreeIcon kind={node.isDir ? "folder" : fileTreeIconKind(node.path, manifest)} open={!collapsed.has(node.path)} />
          <span className="tree-item-name">{node.name}</span>
        </div>
      ))}
      </div>
      {contextMenu && createPortal(
        <Menu className="file-tree-context-menu" label={uiText("File actions")} position={contextMenu}
          onClose={() => setContextMenu(null)}>
          {canRename(contextMenu.path) && (
            <button type="button" role="menuitem" onClick={() => {
              onRename(contextMenu.path);
              setContextMenu(null);
            }}>{uiText("Rename")}</button>
          )}
          {canMove(contextMenu.path) && (
            <button type="button" role="menuitem" onClick={() => {
              onMove(contextMenu.path);
              setContextMenu(null);
            }}>{uiText("Move")}</button>
          )}
          {canSetEntrypoint(contextMenu.path) && (
            <button type="button" role="menuitem" onClick={() => {
              onSetEntrypoint(contextMenu.path);
              setContextMenu(null);
            }}>{uiText("Set as entrypoint")}</button>
          )}
          {onShowReferences && (
            <button type="button" role="menuitem" onClick={() => {
              onShowReferences(contextMenu.path);
              setContextMenu(null);
            }}>{uiText("Show References")}</button>
          )}
          {canDelete(contextMenu.path) && (
            <button type="button" role="menuitem" onClick={() => {
              onDelete(contextMenu.path);
              setContextMenu(null);
            }}>{uiText("Delete")}</button>
          )}
          {(onAddMarkdown || onAddFolder) && (
            canRename(contextMenu.path) || canMove(contextMenu.path) ||
            canSetEntrypoint(contextMenu.path) || canDelete(contextMenu.path) || onShowReferences
          ) && <div className="file-tree-context-menu-divider" role="separator" />}
          {onAddMarkdown && (
            <button type="button" role="menuitem" onClick={() => {
              onAddMarkdown(contextMenu.path);
              setContextMenu(null);
            }}>{uiText("Add Markdown")}</button>
          )}
          {onAddFolder && (
            <button type="button" role="menuitem" onClick={() => {
              onAddFolder(contextMenu.path);
              setContextMenu(null);
            }}>{uiText("Add Folder")}</button>
          )}
        </Menu>,
        document.body,
      )}
    </div>
  );
}
