import { Menu } from "./Menu";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { File as FileIcon, FileText, Folder, FolderOpen, Image as ImageIcon, Workflow, type LucideIcon } from "lucide-react";
import type { FileInfo } from "../types";
import { buildFileTree, type TreeNode } from "../lib/fileTree";
import { PACKAGE_PATH_DRAG_TYPE } from "../lib/packageDrag";
import { fileTreeIconKind, type FileTreeIconKind } from "../lib/fileTreeIcons";

interface Props {
  files: FileInfo[];
  manifest?: Record<string, unknown>;
  directories?: string[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
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

function TreeIcon({ kind, open }: { kind: FileTreeIconKind | "folder"; open?: boolean }) {
  const Icon = kind === "folder" ? (open ? FolderOpen : Folder) : fileIcons[kind];
  const label = kind === "folder" ? "Folder" : kind === "markdown" ? "Markdown"
    : kind === "image" ? "Image" : kind === "diagram" ? "Diagram" : "File";
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
  onShowReferences,
}: Props) {
  const [contextMenu, setContextMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const paths = files.map((f) => f.path);
  const tree = buildFileTree(paths, [...new Set(["images", "attachments", ...directories])]);

  const visible: Array<{ node: TreeNode; depth: number; parent: string | null; position: number; size: number }> = [];
  const visit = (nodes: TreeNode[], depth: number, parent: string | null) => {
    nodes.forEach((node, index) => {
      visible.push({ node, depth, parent, position: index + 1, size: nodes.length });
      if (node.isDir && !collapsed.has(node.path)) visit(node.children, depth + 1, node.path);
    });
  };
  visit(tree, 0, null);
  const tabPath = visible.some(({ node }) => node.path === focusedPath) ? focusedPath
    : visible.some(({ node }) => node.path === selectedPath) ? selectedPath : visible[0]?.node.path;
  const toggle = (path: string) => setCollapsed((current) => {
    const next = new Set(current);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    return next;
  });
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

  return (
    <div ref={treeRef} className="file-tree" role="tree" aria-label="Package files"
      onDragOver={(event) => { if (onDropPath) event.preventDefault(); }}
      onDrop={(event) => {
        const sourcePath = event.dataTransfer.getData(PACKAGE_PATH_DRAG_TYPE);
        if (!sourcePath || !onDropPath) return;
        event.preventDefault();
        const name = sourcePath.slice(sourcePath.lastIndexOf("/") + 1);
        onDropPath(sourcePath, name);
      }}
    >
      {visible.map(({ node, depth, parent, position, size }, index) => (
        <div key={node.path} role="treeitem" aria-label={node.name}
          aria-level={depth + 1} aria-posinset={position} aria-setsize={size}
          aria-expanded={node.isDir ? !collapsed.has(node.path) : undefined}
          aria-selected={node.path === selectedPath} data-path={node.path}
          tabIndex={node.path === tabPath ? 0 : -1}
          className={`tree-item ${node.isDir ? "tree-dir" : ""} ${node.path === selectedPath ? "selected" : ""} ${dragOverPath === node.path ? "drop-target" : ""}`}
          style={{ paddingLeft: depth * 12 + 8 }}
          onFocus={() => setFocusedPath(node.path)}
          onClick={(event) => {
            event.currentTarget.focus();
            if (node.isDir) toggle(node.path);
            else onSelect(node.path);
          }}
          onDoubleClick={() => {
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
              if (node.isDir && collapsed.has(node.path)) toggle(node.path);
              else if (visible[index + 1]?.parent === node.path) focusPath(visible[index + 1].node.path);
            } else if (event.key === "ArrowLeft") {
              if (node.isDir && !collapsed.has(node.path)) toggle(node.path);
              else if (parent) focusPath(parent);
            } else if (node.isDir) toggle(node.path);
            else onSelect(node.path);
          }}
          onContextMenu={(event) => {
            if (!hasActions(node.path)) return;
            event.preventDefault();
            event.currentTarget.focus();
            setContextMenu({ path: node.path, x: event.clientX, y: event.clientY });
          }}
          draggable
          onDragStart={(event) => {
            event.stopPropagation();
            event.dataTransfer.effectAllowed = "copyMove";
            event.dataTransfer.setData(PACKAGE_PATH_DRAG_TYPE, node.path);
          }}
          onDragOver={(event) => {
            if (!node.isDir || (!onDropPath && node.path !== imageDropDirectory)) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = "move";
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
          {node.isDir && <span className="tree-item-disclosure">{collapsed.has(node.path) ? "▸ " : "▾ "}</span>}
          <TreeIcon kind={node.isDir ? "folder" : fileTreeIconKind(node.path, manifest)} open={!collapsed.has(node.path)} />
          <span className="tree-item-name">{node.name}</span>
        </div>
      ))}
      {contextMenu && createPortal(
        <Menu className="file-tree-context-menu" label="File actions" position={contextMenu}
          onClose={() => setContextMenu(null)}>
          {canRename(contextMenu.path) && (
            <button type="button" role="menuitem" onClick={() => {
              onRename(contextMenu.path);
              setContextMenu(null);
            }}>Rename</button>
          )}
          {canMove(contextMenu.path) && (
            <button type="button" role="menuitem" onClick={() => {
              onMove(contextMenu.path);
              setContextMenu(null);
            }}>Move</button>
          )}
          {canSetEntrypoint(contextMenu.path) && (
            <button type="button" role="menuitem" onClick={() => {
              onSetEntrypoint(contextMenu.path);
              setContextMenu(null);
            }}>Set as entrypoint</button>
          )}
          {onShowReferences && (
            <button type="button" role="menuitem" onClick={() => {
              onShowReferences(contextMenu.path);
              setContextMenu(null);
            }}>Show References</button>
          )}
          {canDelete(contextMenu.path) && (
            <button type="button" role="menuitem" onClick={() => {
              onDelete(contextMenu.path);
              setContextMenu(null);
            }}>Delete</button>
          )}
          {(onAddMarkdown || onAddFolder) && (
            canRename(contextMenu.path) || canMove(contextMenu.path) ||
            canSetEntrypoint(contextMenu.path) || canDelete(contextMenu.path) || onShowReferences
          ) && <div className="file-tree-context-menu-divider" role="separator" />}
          {onAddMarkdown && (
            <button type="button" role="menuitem" onClick={() => {
              onAddMarkdown(contextMenu.path);
              setContextMenu(null);
            }}>Add Markdown</button>
          )}
          {onAddFolder && (
            <button type="button" role="menuitem" onClick={() => {
              onAddFolder(contextMenu.path);
              setContextMenu(null);
            }}>Add Folder</button>
          )}
        </Menu>,
        document.body,
      )}
    </div>
  );
}
