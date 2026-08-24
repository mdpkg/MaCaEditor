import { type ReactNode, useEffect, useRef } from "react";
import { EditorView } from "@codemirror/view";

interface Props {
  children: ReactNode;
}

interface ScrollAnchor {
  source: number;
  target: number;
}

export function interpolateScroll(position: number, anchors: ScrollAnchor[]): number {
  if (anchors.length === 0) return 0;
  const nextIndex = anchors.findIndex((anchor) => anchor.source >= position);
  if (nextIndex <= 0) return anchors[nextIndex < 0 ? anchors.length - 1 : 0].target;
  const previous = anchors[nextIndex - 1];
  const next = anchors[nextIndex];
  const distance = next.source - previous.source;
  if (distance <= 0) return next.target;
  return previous.target + (next.target - previous.target)
    * ((position - previous.source) / distance);
}

/** Keeps the CodeMirror source and rendered Markdown at the same relative position. */
export function SynchronizedScrollView({ children }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let editor: HTMLElement | null = null;
    let preview: HTMLElement | null = null;
    let syncing: HTMLElement | null = null;
    let releaseSync = 0;

    const stopSyncing = () => {
      syncing = null;
      releaseSync = 0;
    };

    const anchorPairs = (): Array<{ editor: number; preview: number }> => {
      if (!editor || !preview) return [];
      const view = EditorView.findFromDOM(editor);
      const editorMax = Math.max(0, editor.scrollHeight - editor.clientHeight);
      const previewMax = Math.max(0, preview.scrollHeight - preview.clientHeight);
      const previewElement = preview;
      const pairs = [{ editor: 0, preview: 0 }];
      if (view) {
        previewElement.querySelectorAll<HTMLElement>("[data-source-offset]").forEach((heading) => {
          const offset = Number(heading.dataset.sourceOffset);
          if (!Number.isFinite(offset) || offset < 0 || offset > view.state.doc.length) return;
          const previewTop = heading.getBoundingClientRect().top
            - previewElement.getBoundingClientRect().top + previewElement.scrollTop;
          pairs.push({
            editor: Math.min(editorMax, Math.max(0, view.lineBlockAt(offset).top)),
            preview: Math.min(previewMax, Math.max(0, previewTop)),
          });
        });
      }
      pairs.push({ editor: editorMax, preview: previewMax });
      return pairs.sort((a, b) => a.editor - b.editor || a.preview - b.preview);
    };

    const synchronize = (source: HTMLElement, target: HTMLElement, fromEditor: boolean) => {
      if (syncing === source) return;
      syncing = target;
      const pairs = anchorPairs();
      const anchors = pairs.map((pair) => fromEditor
        ? { source: pair.editor, target: pair.preview }
        : { source: pair.preview, target: pair.editor })
        .sort((a, b) => a.source - b.source);
      target.scrollTop = interpolateScroll(source.scrollTop, anchors);
      if (releaseSync) cancelAnimationFrame(releaseSync);
      releaseSync = requestAnimationFrame(stopSyncing);
    };

    const editorScrolled = () => {
      if (editor && preview) synchronize(editor, preview, true);
    };
    const previewScrolled = () => {
      if (editor && preview) synchronize(preview, editor, false);
    };

    const connect = () => {
      const nextEditor = root.querySelector<HTMLElement>(".markdown-editor .cm-scroller");
      const nextPreview = root.querySelector<HTMLElement>(".markdown-preview");
      if (nextEditor !== editor) {
        editor?.removeEventListener("scroll", editorScrolled);
        editor = nextEditor;
        editor?.addEventListener("scroll", editorScrolled, { passive: true });
      }
      if (nextPreview !== preview) {
        preview?.removeEventListener("scroll", previewScrolled);
        preview = nextPreview;
        preview?.addEventListener("scroll", previewScrolled, { passive: true });
      }
    };

    connect();
    const observer = new MutationObserver(connect);
    observer.observe(root, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      editor?.removeEventListener("scroll", editorScrolled);
      preview?.removeEventListener("scroll", previewScrolled);
      if (releaseSync) cancelAnimationFrame(releaseSync);
    };
  }, []);

  return <div ref={rootRef} className="split-view">{children}</div>;
}
