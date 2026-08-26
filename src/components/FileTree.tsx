import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { FileInfo } from "../types";
import { buildFileTree, type TreeNode } from "../lib/fileTree";

interface Props {
  files: FileInfo[];
  directories?: string[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onEditMarkdown?: (path: string) => void;
  onDropImages: (files: File[]) => void;
  canRename: (path: string) => boolean;
  onRename: (path: string) => void;
  canDelete: (path: string) => boolean;
  onDelete: (path: string) => void;
  canMove?: (path: string) => boolean;
  onMove?: (path: string) => void;
  canSetEntrypoint?: (path: string) => boolean;
  onSetEntrypoint?: (path: string) => void;
}

function TreeItem({
  node,
  selectedPath,
  onSelect,
  onEditMarkdown,
  depth,
  onDropImages,
  onContextMenu,
}: {
  node: TreeNode;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onEditMarkdown?: (path: string) => void;
  depth: number;
  onDropImages: (files: File[]) => void;
  onContextMenu: (event: React.MouseEvent, path: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [dragOver, setDragOver] = useState(false);

  if (!node.isDir) {
    return (
      <div
        className={`tree-item ${selectedPath === node.path ? "selected" : ""}`}
        style={{ paddingLeft: depth * 12 + 8 }}
        onClick={() => onSelect(node.path)}
        onDoubleClick={() => {
          if (!/\.(md|markdown)$/i.test(node.path)) return;
          onSelect(node.path);
          onEditMarkdown?.(node.path);
        }}
        onContextMenu={(event) => onContextMenu(event, node.path)}
      >
        {node.name}
      </div>
    );
  }

  return (
    <div>
      <div
        className={`tree-item tree-dir ${dragOver ? "drop-target" : ""}`}
        style={{ paddingLeft: depth * 12 + 8 }}
        onClick={() => setOpen((o) => !o)}
        onContextMenu={(event) => onContextMenu(event, node.path)}
        onDragOver={(event) => {
          if (node.path !== "images") return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          if (node.path !== "images") return;
          event.preventDefault();
          setDragOver(false);
          onDropImages(Array.from(event.dataTransfer.files));
        }}
      >
        {open ? "▾" : "▸"} {node.name}
      </div>
      {open &&
        node.children.map((child) => (
          <TreeItem
            key={child.path}
            node={child}
            selectedPath={selectedPath}
            onSelect={onSelect}
            onEditMarkdown={onEditMarkdown}
            depth={depth + 1}
            onDropImages={onDropImages}
            onContextMenu={onContextMenu}
          />
        ))}
    </div>
  );
}

export function FileTree({
  files, directories = [], selectedPath, onSelect, onEditMarkdown, onDropImages,
  canRename, onRename, canDelete, onDelete, canMove = () => false, onMove = () => {},
  canSetEntrypoint = () => false, onSetEntrypoint = () => {},
}: Props) {
  const [contextMenu, setContextMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  const paths = files.map((f) => f.path);
  const tree = buildFileTree(paths, [...new Set(["images", "attachments", ...directories])]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
    };
  }, [contextMenu]);

  const openContextMenu = (event: React.MouseEvent, path: string) => {
    if (!canRename(path) && !canDelete(path) && !canMove(path) && !canSetEntrypoint(path)) return;
    event.preventDefault();
    onSelect(path);
    setContextMenu({ path, x: event.clientX, y: event.clientY });
  };

  return (
    <div className="file-tree">
      {tree.map((node) => (
        <TreeItem
          key={node.path}
          node={node}
          selectedPath={selectedPath}
          onSelect={onSelect}
          onEditMarkdown={onEditMarkdown}
          depth={0}
          onDropImages={onDropImages}
          onContextMenu={openContextMenu}
        />
      ))}
      {contextMenu && createPortal(
        <div
          className="file-tree-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          {canRename(contextMenu.path) && (
            <button type="button" onClick={() => {
              onRename(contextMenu.path);
              setContextMenu(null);
            }}>Rename</button>
          )}
          {canMove(contextMenu.path) && (
            <button type="button" onClick={() => {
              onMove(contextMenu.path);
              setContextMenu(null);
            }}>Move</button>
          )}
          {canSetEntrypoint(contextMenu.path) && (
            <button type="button" onClick={() => {
              onSetEntrypoint(contextMenu.path);
              setContextMenu(null);
            }}>Set as entrypoint</button>
          )}
          {canDelete(contextMenu.path) && (
            <button type="button" onClick={() => {
              onDelete(contextMenu.path);
              setContextMenu(null);
            }}>Delete</button>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
