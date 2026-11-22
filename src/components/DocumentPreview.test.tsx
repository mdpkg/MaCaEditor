import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DocumentPreview } from "./DocumentPreview";
import { renderMarp } from "../lib/marp/render";
import { EditorView } from "@codemirror/view";

vi.mock("../lib/marp/render", () => ({ renderMarp: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
const rendered = { html: '<article data-slide-index="0">A</article><article data-slide-index="1">B</article>', css: "", warnings: [], slides: [
  { slideIndex: 0, startOffset: 0, endOffset: 30 }, { slideIndex: 1, startOffset: 30, endOffset: 60 },
] };
const props = { path: "slides.md", baseDir: "", files: [], markdown: "---\nmarp: true\n---\n# A\n\n---\n# B" };
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(renderMarp).mockReset().mockReturnValue(rendered);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });
async function tick() { await act(async () => { await vi.advanceTimersByTimeAsync(260); }); }

test("automatically selects Marp only for Markdown boolean frontmatter and displays invalid YAML warnings", async () => {
  act(() => root.render(<DocumentPreview {...props} />));
  await tick();
  expect(host.querySelector("iframe")?.getAttribute("sandbox")).toBe("allow-scripts");
  expect(renderMarp).toHaveBeenCalledWith(props.markdown, "", []);
  act(() => root.render(<DocumentPreview {...props} markdown={'---\nmarp: "true"\n---\n# Normal'} />));
  expect(host.querySelector(".markdown-preview h1")?.textContent).toBe("Normal");
  expect(host.querySelector("iframe")).toBeNull();
  act(() => root.render(<DocumentPreview {...props} path="text.txt" />));
  expect(host.querySelector("iframe")).toBeNull();
  act(() => root.render(<DocumentPreview {...props} markdown={"---\nmarp: [\n---"} />));
  expect(host.querySelector('[role="status"]')?.textContent).toContain("frontmatter");
});

test("debounces edits, reuses the frame, updates resources and navigates whole slides", async () => {
  const onPosition = vi.fn();
  act(() => root.render(<DocumentPreview {...props} onMarpPositionChange={onPosition} />));
  await tick();
  const frame = host.querySelector("iframe")!;
  const send = vi.spyOn(frame.contentWindow!, "postMessage");
  const session = frame.dataset.session!;
  act(() => window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, data: { channel: "maca-marp", session, generation: 0, type: "ready" } })));
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "render", generation: 1 }), "*");
  act(() => (host.querySelector('[aria-label="次のスライド"]') as HTMLButtonElement).click());
  expect(host.textContent).toContain("2 / 2");
  expect(onPosition).toHaveBeenLastCalledWith({ source: props.markdown, offset: 30 });
  for (const suffix of ["1", "2", "3"]) act(() => root.render(<DocumentPreview {...props} markdown={props.markdown + suffix} />));
  expect(renderMarp).toHaveBeenCalledTimes(1);
  await tick();
  expect(renderMarp).toHaveBeenCalledTimes(2);
  expect(host.querySelector("iframe")).toBe(frame);
  act(() => root.render(<DocumentPreview {...props} files={[{ path: "image.svg", content: "updated", is_text: true, base64: null }]} />));
  await tick();
  expect(renderMarp).toHaveBeenCalledTimes(3);
});

test("retains successful output on errors, offers retry and isolates documents", async () => {
  act(() => root.render(<DocumentPreview {...props} />)); await tick();
  vi.mocked(renderMarp).mockImplementation(() => { throw new Error("conversion failed"); });
  act(() => root.render(<DocumentPreview {...props} markdown={props.markdown + "bad"} />)); await tick();
  expect(host.textContent).toContain("conversion failed");
  expect(host.textContent).toContain("1 / 2");
  expect(host.querySelector('[role="alert"] button')?.textContent).toBe("再試行");
  act(() => root.render(<DocumentPreview {...props} path="other.md" />)); await tick();
  expect(host.textContent).not.toContain("1 / 2");
});

test("synchronizes only slide changes in both directions without scroll echoes", async () => {
  const dispatch = vi.fn();
  let editorOffset = 0;
  const view = { state: { doc: { length: 60 } }, dispatch, lineBlockAtHeight: () => ({ from: editorOffset }) };
  const find = vi.spyOn(EditorView, "findFromDOM").mockReturnValue(view as unknown as EditorView);
  act(() => root.render(<div className="split-view"><div className="markdown-editor"><div className="cm-scroller" /></div><DocumentPreview {...props} /></div>));
  await tick();
  const frame = host.querySelector("iframe")!;
  const send = vi.spyOn(frame.contentWindow!, "postMessage");
  const message = (index: number) => window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, data: { channel: "maca-marp", session: frame.dataset.session, generation: 1, type: "slide", index } }));
  dispatch.mockClear();
  act(() => message(1));
  expect(dispatch).toHaveBeenCalledTimes(1);
  act(() => message(1));
  expect(dispatch).toHaveBeenCalledTimes(1);
  editorOffset = 30;
  act(() => host.querySelector(".cm-scroller")!.dispatchEvent(new Event("scroll")));
  expect(send).not.toHaveBeenCalled();
  editorOffset = 0;
  act(() => host.querySelector(".cm-scroller")!.dispatchEvent(new Event("scroll")));
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "go", index: 0 }), "*");
  act(() => message(0));
  expect(dispatch).toHaveBeenCalledTimes(1);
  find.mockRestore();
});

test("discards superseded debounced documents and reports iframe initialization failure", async () => {
  act(() => root.render(<DocumentPreview {...props} />));
  act(() => root.render(<DocumentPreview {...props} path="next.md" markdown={props.markdown + "next"} />));
  await tick();
  expect(renderMarp).toHaveBeenCalledTimes(1);
  expect(renderMarp).toHaveBeenCalledWith(props.markdown + "next", "", []);
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("初期化");
});
