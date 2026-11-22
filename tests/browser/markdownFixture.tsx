import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { MarkdownPreview } from "../../src/components/MarkdownPreview";
import type { FileInfo } from "../../src/types";

let root: Root;
export const actions: string[] = [];
export let sourceFiles: FileInfo[];
export function mount(markdown: string, files: FileInfo[] = [], baseDir = "") {
  root?.unmount();
  actions.length = 0;
  sourceFiles = files;
  root = createRoot(document.getElementById("app")!);
  root.render(<MarkdownPreview markdown={markdown} files={files} baseDir={baseDir}
    onNavigateMarkdown={(path) => actions.push(path)}
    onDownloadAttachment={(file) => actions.push(file.path)} />);
}
