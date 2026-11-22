import { useEffect, useMemo, useRef, useState } from "react";
import type { FileInfo } from "../types";
import type { MarpResult } from "../lib/marp/render";
import { mapSourceOffset, slideAtOffset } from "../lib/marp/position";
import { createFrameSession, createFrameShell, readFrameMessage } from "../lib/marp/frame";
import { isMarkdownPath, resolvePackagePath } from "../lib/markdown";
import { EditorView } from "@codemirror/view";

export interface MarpPosition { source: string; offset: number }
interface Props {
  markdown: string;
  baseDir: string;
  files: FileInfo[];
  initialPosition?: MarpPosition;
  onPositionChange?: (position: MarpPosition) => void;
  onNavigateMarkdown?: (path: string) => void;
  onDownloadAttachment?: (file: FileInfo) => void;
}
interface Snapshot { source: string; result: MarpResult; generation: number; index: number }

export function MarpPreview(props: Props) {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState("");
  const [current, setCurrent] = useState(0);
  const [retry, setRetry] = useState(0);
  const [ready, setReady] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props); latest.current = props;
  const saved = useRef(props.initialPosition);
  const active = useRef(0);
  const successful = useRef<Snapshot>();
  const sequence = useRef(0);
  const renderedGeneration = useRef(0);
  const editorView = useRef<EditorView | null>(null);
  const lastEditorSlide = useRef(-1);
  const syncingEditor = useRef(false);
  const releaseSync = useRef(0);
  const session = useMemo(() => createFrameSession(), [retry]);
  const shell = useMemo(() => createFrameShell(session), [session]);
  const { markdown, baseDir, files } = props;

  const remember = (index: number, value = successful.current) => {
    if (!value) return;
    const position = { source: value.source, offset: value.result.slides[index]?.startOffset ?? 0 };
    saved.current = position;
    latest.current.onPositionChange?.(position);
  };
  const synchronizeEditor = (index: number) => {
    const view = editorView.current;
    const slide = successful.current?.result.slides[index];
    if (!view || !slide || successful.current?.source !== latest.current.markdown || lastEditorSlide.current === index) return;
    lastEditorSlide.current = index;
    syncingEditor.current = true;
    cancelAnimationFrame(releaseSync.current);
    view.dispatch({ effects: EditorView.scrollIntoView(Math.min(view.state.doc.length, slide.startOffset), { y: "start" }) });
    // CodeMirror measures and scrolls on its next frame. Ignore that scroll's
    // echo, including a partially visible preceding line at the viewport edge.
    releaseSync.current = requestAnimationFrame(() => {
      releaseSync.current = requestAnimationFrame(() => { syncingEditor.current = false; });
    });
  };
  const go = (index: number, fromEditor = false) => {
    const value = successful.current;
    if (!value || index < 0 || index >= value.result.slides.length || index === active.current) return;
    active.current = index; setCurrent(index); remember(index);
    if (fromEditor) lastEditorSlide.current = index;
    else synchronizeEditor(index);
    frame.current?.contentWindow?.postMessage({ channel: "maca-marp", session, generation: value.generation, type: "go", index }, "*");
  };

  useEffect(() => {
    let cancelled = false;
    const generation = ++sequence.current;
    const timer = setTimeout(async () => {
      try {
        const { renderMarp } = await import("../lib/marp/render");
        if (cancelled) return;
        const result = renderMarp(markdown, baseDir, files);
        if (cancelled) return;
        const position = saved.current;
        const offset = position ? mapSourceOffset(position.source, markdown, position.offset) : 0;
        const index = slideAtOffset(result.slides, offset);
        const next = { source: markdown, result, generation, index };
        successful.current = next;
        active.current = index; setCurrent(index); setSnapshot(next); setError(""); remember(index, next);
      } catch (reason) {
        if (!cancelled) setError(`Marp プレビューを更新できません: ${reason instanceof Error ? reason.message : String(reason)}`);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [markdown, baseDir, files, retry]);

  useEffect(() => {
    setReady(false);
    const receive = (event: MessageEvent) => {
      const value = successful.current;
      const message = readFrameMessage(event, frame.current?.contentWindow ?? null, session, value?.generation ?? 0, value?.result.slides.length ?? 0);
      if (!message) return;
      if (message.type === "ready") setReady(true);
      if (message.type === "rendered") renderedGeneration.current = message.generation;
      if (message.type === "slide" && message.index !== active.current) {
        active.current = message.index!; setCurrent(message.index!); remember(message.index!);
        synchronizeEditor(message.index!);
      }
      if (message.type === "link" && message.href) {
        const href = message.href;
        if (/^(https?:|mailto:)/i.test(href)) { window.open(href, "_blank", "noopener,noreferrer"); return; }
        let decoded: string;
        try { decoded = decodeURIComponent(href.split(/[?#]/)[0]); } catch { return; }
        const path = resolvePackagePath(latest.current.baseDir, decoded);
        const file = latest.current.files.find((candidate) => candidate.path === path);
        if (file && isMarkdownPath(file.path)) latest.current.onNavigateMarkdown?.(file.path);
        else if (file && /(^|\/)attachments\//.test(file.path)) latest.current.onDownloadAttachment?.(file);
      }
    };
    window.addEventListener("message", receive);
    const timer = setTimeout(() => {
      if (!renderedGeneration.current) setError("スライド画面を初期化できません。再試行してください。");
    }, 10_000);
    return () => { window.removeEventListener("message", receive); clearTimeout(timer); };
  }, [session]);

  useEffect(() => {
    if (!snapshot || !ready) return;
    frame.current?.contentWindow?.postMessage({ channel: "maca-marp", session, generation: snapshot.generation, type: "render", html: snapshot.result.html, css: snapshot.result.css, index: snapshot.index }, "*");
    const timer = setTimeout(() => {
      if (renderedGeneration.current !== snapshot.generation) setError("スライド画面の更新を確認できません。再試行してください。");
    }, 10_000);
    return () => clearTimeout(timer);
  }, [snapshot, ready, session]);

  useEffect(() => {
    const split = host.current?.closest(".split-view");
    if (!split || !snapshot) return;
    let scroller: HTMLElement | null = null;
    const editorScrolled = () => {
      const view = editorView.current;
      if (!view || !scroller || syncingEditor.current || snapshot.source !== latest.current.markdown) return;
      // Whole CodeMirror line blocks identify the source slide. We deliberately
      // do not interpolate paragraph/DOM positions inside a Marp slide.
      const top = typeof view.documentTop === "number" ? scroller.getBoundingClientRect().top - view.documentTop : scroller.scrollTop;
      const offset = view.lineBlockAtHeight(Math.max(0, top + (view.defaultLineHeight ?? 0))).from;
      go(slideAtOffset(snapshot.result.slides, offset), true);
    };
    const connect = () => {
      const next = split.querySelector<HTMLElement>(".markdown-editor .cm-scroller");
      if (scroller === next) return;
      scroller?.removeEventListener("scroll", editorScrolled);
      scroller = next;
      editorView.current = next ? EditorView.findFromDOM(next) : null;
      lastEditorSlide.current = -1;
      scroller?.addEventListener("scroll", editorScrolled, { passive: true });
      if (editorView.current && scroller && slideAtOffset(snapshot.result.slides, editorView.current.lineBlockAtHeight(scroller.scrollTop).from) !== active.current) synchronizeEditor(active.current);
    };
    connect();
    const observer = new MutationObserver(connect);
    observer.observe(split, { childList: true, subtree: true });
    return () => {
      observer.disconnect(); scroller?.removeEventListener("scroll", editorScrolled); editorView.current = null;
      cancelAnimationFrame(releaseSync.current); syncingEditor.current = false;
    };
  }, [snapshot, session]);

  return <div className="marp-preview" ref={host}>
    <div className="marp-navigation" aria-label="スライド移動">
      <button aria-label="前のスライド" disabled={!snapshot || current === 0} onClick={() => go(current - 1)}>前へ</button>
      <span aria-live="polite">{snapshot ? `${current + 1} / ${snapshot.result.slides.length}` : "スライドを準備中…"}</span>
      <button aria-label="次のスライド" disabled={!snapshot || current >= snapshot.result.slides.length - 1} onClick={() => go(current + 1)}>次へ</button>
      <span title="Marp スライドの印刷は未対応です。">印刷非対応</span>
    </div>
    {error && <div role="alert" className="preview-warning">{error} <button onClick={() => { renderedGeneration.current = 0; setRetry((value) => value + 1); }}>再試行</button></div>}
    {!!snapshot?.result.warnings.length && <details className="preview-warning"><summary>プレビューの警告 ({snapshot.result.warnings.length})</summary>{snapshot.result.warnings.map((warning) => <p key={warning}>{warning}</p>)}</details>}
    <iframe ref={frame} title="Marp スライドプレビュー" sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={shell} data-session={session}
      onLoad={() => frame.current?.contentWindow?.postMessage({ channel: "maca-marp", session, generation: 0, type: "hello" }, "*")} />
  </div>;
}
