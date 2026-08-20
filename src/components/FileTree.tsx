import { useState } from "react";
import type { FileInfo } from "../types";
import { buildFileTree, type TreeNode } from "../lib/fileTree";

interface Props {
  files: FileInfo[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onDropImages: (files: File[]) => void;
}

function TreeItem({
  node,
  selectedPath,
  onSelect,
  depth,
  onDropImages,
}: {
  node: TreeNode;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  depth: number;
  onDropImages: (files: File[]) => void;
}) {
  const [open, setOpen] = useState(true);
  const [dragOver, setDragOver] = useState(false);

  if (!node.isDir) {
    return (
      <div
        className={`tree-item ${selectedPath === node.path ? "selected" : ""}`}
        style={{ paddingLeft: depth * 12 + 8 }}
        onClick={() => onSelect(node.path)}
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
            depth={depth + 1}
            onDropImages={onDropImages}
          />
        ))}
    </div>
  );
}

export function FileTree({ files, selectedPath, onSelect, onDropImages }: Props) {
  const paths = files.map((f) => f.path);
  const tree = buildFileTree(paths, ["images"]);

  return (
    <div className="file-tree">
      {tree.map((node) => (
        <TreeItem
          key={node.path}
          node={node}
          selectedPath={selectedPath}
          onSelect={onSelect}
          depth={0}
          onDropImages={onDropImages}
        />
      ))}
    </div>
  );
}
