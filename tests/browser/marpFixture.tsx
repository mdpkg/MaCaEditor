import React, { useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorView } from "@codemirror/view";
import { DocumentPreview } from "../../src/components/DocumentPreview";
import { MarkdownEditor } from "../../src/components/MarkdownEditor";
import type { MarpPosition } from "../../src/components/MarpPreview";
import type { FileInfo } from "../../src/types";
export { createFrameShell } from "../../src/lib/marp/frame";
export { renderMarp } from "../../src/lib/marp/render";

let root: Root;
let update: (value: string) => void;
export const actions: string[] = [];
export function mount(markdown: string, files: FileInfo[] = [], split = true) {
  function Fixture() {
    const [source, setSource] = useState(markdown);
    const position = useRef<MarpPosition>();
    update = setSource;
    const preview = <DocumentPreview path="slides.md" baseDir="" files={files} markdown={source}
      initialMarpPosition={position.current} onMarpPositionChange={(value) => { position.current = value; }}
      onNavigateMarkdown={(path) => actions.push(path)} onDownloadAttachment={(file) => actions.push(file.path)} />;
    return split ? <div className="split-view"><MarkdownEditor value={source} onChange={setSource} />{preview}</div> : <div className="preview-only">{preview}</div>;
  }
  root?.unmount();
  root = createRoot(document.getElementById("app")!);
  root.render(<Fixture />);
}
export function replaceSource(markdown: string) { update(markdown); }
export function scrollEditor(offset: number) {
  const view = EditorView.findFromDOM(document.querySelector(".cm-scroller")!);
  view?.dispatch({ effects: EditorView.scrollIntoView(offset, { y: "start" }) });
}
export function editorOffset() {
  const scroller = document.querySelector<HTMLElement>(".cm-scroller")!;
  return EditorView.findFromDOM(scroller)!.lineBlockAtHeight(scroller.scrollTop).from;
}
