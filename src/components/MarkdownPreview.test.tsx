import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("MarkdownPreview", () => {
  test("restores and reports the Markdown scroll ratio", () => {
    let restoreFrame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      restoreFrame = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const onScrollRatioChange = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <MarkdownPreview
        markdown="# Document"
        baseDir=""
        files={[]}
        scrollRestoreKey="README.md"
        initialScrollRatio={0.75}
        onScrollRatioChange={onScrollRatioChange}
      />,
    ));
    const preview = container.querySelector(".markdown-preview") as HTMLDivElement;
    Object.defineProperties(preview, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 200 },
    });

    act(() => restoreFrame?.(0));
    expect(preview.scrollTop).toBe(600);
    expect(onScrollRatioChange).toHaveBeenLastCalledWith(0.75);

    preview.scrollTop = 400;
    act(() => preview.dispatchEvent(new Event("scroll")));
    expect(onScrollRatioChange).toHaveBeenLastCalledWith(0.5);

    act(() => root.unmount());
    vi.unstubAllGlobals();
  });

  test("renders package attachments as download links", () => {
    const onDownloadAttachment = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <MarkdownPreview
        markdown="[仕様書](attachments/仕様書.pdf)"
        baseDir=""
        files={[{
          path: "attachments/仕様書.pdf",
          is_text: false,
          content: null,
          base64: "AQID",
        }]}
        onDownloadAttachment={onDownloadAttachment}
      />,
    ));

    const link = container.querySelector("a") as HTMLAnchorElement;
    expect(link.download).toBe("仕様書.pdf");
    expect(link.href).toBe("data:application/octet-stream;base64,AQID");
    act(() => link.click());
    expect(onDownloadAttachment).toHaveBeenCalledWith({
      path: "attachments/仕様書.pdf",
      is_text: false,
      content: null,
      base64: "AQID",
    });
    act(() => root.unmount());
  });

  test("downloads a text attachment linked from nested Markdown", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <MarkdownPreview
        markdown="[notes](../attachments/notes.txt)"
        baseDir="docs"
        files={[{
          path: "attachments/notes.txt",
          is_text: true,
          content: "日本語のメモ",
          base64: null,
        }]}
      />,
    ));

    const link = container.querySelector("a") as HTMLAnchorElement;
    expect(link.download).toBe("notes.txt");
    expect(link.href).toContain("data:text/plain;charset=utf-8,");
    expect(decodeURIComponent(link.href)).toContain("日本語のメモ");
    act(() => root.unmount());
  });

  test("opens a package markdown link inside the editor", () => {
    const onNavigateMarkdown = vi.fn();
    const container = document.createElement("div"); document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<MarkdownPreview markdown="[Guide](../guide.md)" baseDir="docs"
      files={[{ path: "guide.md", is_text: true, content: "# Guide", base64: null }]}
      onNavigateMarkdown={onNavigateMarkdown} />));
    const link = container.querySelector("a") as HTMLAnchorElement;
    act(() => link.click());
    expect(onNavigateMarkdown).toHaveBeenCalledWith("guide.md");
    act(() => root.unmount());
  });


  test("shows a generated table of contents when enabled", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <MarkdownPreview
        markdown={"# Document\n\n## First section\n\n### Details\n\n## Second section"}
        baseDir=""
        files={[]}
        showToc
      />,
    ));

    expect(container.querySelector("h2")?.textContent).toBe("目次");
    expect(Array.from(container.querySelectorAll("h2 + ul a")).map((link) => link.textContent))
      .toEqual(["Document", "First section", "Details", "Second section"]);
    act(() => root.unmount());
  });

  test("hides the table of contents by default", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <MarkdownPreview markdown={"# Document\n\n## Section"} baseDir="" files={[]} />,
    ));

    expect(container.textContent).not.toContain("目次");
    act(() => root.unmount());
  });

  test("renders CommonMark structure with react-markdown", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <MarkdownPreview
        markdown={"# Title\n\n- parent\n  - child\n\n**bold** and `code`"}
        baseDir=""
        files={[]}
      />,
    ));

    expect(container.querySelector("h1")?.textContent).toBe("Title");
    expect(container.querySelectorAll("ul")).toHaveLength(2);
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("code")?.textContent).toBe("code");
    act(() => root.unmount());
  });

  test("renders GitHub Flavored Markdown tables and task lists", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <MarkdownPreview
        markdown={"| Name | Value |\n| --- | ---: |\n| Alpha | 10 |\n\n- [x] Done\n- [ ] Todo"}
        baseDir=""
        files={[]}
      />,
    ));

    expect(container.querySelectorAll("table th")).toHaveLength(2);
    expect(container.querySelector("table td")?.textContent).toBe("Alpha");
    const tasks = container.querySelectorAll('input[type="checkbox"]');
    expect(tasks).toHaveLength(2);
    expect((tasks[0] as HTMLInputElement).checked).toBe(true);
    act(() => root.unmount());
  });

  test.each([
    ["NOTE", "Note"],
    ["TIP", "Tip"],
    ["IMPORTANT", "Important"],
    ["WARNING", "Warning"],
    ["CAUTION", "Caution"],
  ])("renders the GitHub Flavored Markdown %s alert", (kind, title) => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <MarkdownPreview
        markdown={`> [!${kind}]\n> Alert body`}
        baseDir=""
        files={[]}
      />,
    ));

    const alert = container.querySelector(`.markdown-alert-${kind.toLowerCase()}`);
    expect(alert).not.toBeNull();
    expect(alert?.querySelector(".markdown-alert-title")?.textContent).toBe(title);
    expect(alert?.textContent).toContain("Alert body");
    expect(alert?.textContent).not.toContain(`[!${kind}]`);
    act(() => root.unmount());
  });

  test("keeps an ordinary blockquote unchanged", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <MarkdownPreview markdown="> Ordinary quote" baseDir="" files={[]} />,
    ));

    expect(container.querySelector("blockquote")?.textContent).toContain("Ordinary quote");
    expect(container.querySelector(".markdown-alert")).toBeNull();
    act(() => root.unmount());
  });

  test.each([
    ["note", "Note"],
    ["tip", "Tip"],
    ["important", "Important"],
    ["info", "Info"],
    ["warning", "Warning"],
    ["danger", "Danger"],
    ["caution", "Caution"],
  ])("renders an Rspress %s container when Rspress mode is enabled", (kind, title) => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <MarkdownPreview
        markdown={`:::${kind}\nContainer **body**\n:::`}
        baseDir=""
        files={[]}
        rspressMode
      />,
    ));

    const callout = container.querySelector(`.rspress-container-${kind}`);
    expect(callout?.querySelector(".rspress-container-title")?.textContent).toBe(title);
    expect(callout?.querySelector("strong")?.textContent).toBe("body");
    expect(callout?.textContent).not.toContain(":::");
    act(() => root.unmount());
  });

  test.each([
    [":::tip Custom title", "Custom title"],
    [':::tip{title="Attribute title"}', "Attribute title"],
  ])("renders an Rspress custom container title from %s", (opening, title) => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <MarkdownPreview
        markdown={`${opening}\nBody\n:::`}
        baseDir=""
        files={[]}
        rspressMode
      />,
    ));

    expect(container.querySelector(".rspress-container-title")?.textContent).toBe(title);
    act(() => root.unmount());
  });

  test("renders an Rspress details container as expandable details", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <MarkdownPreview
        markdown={":::details More information\nHidden body\n:::"}
        baseDir=""
        files={[]}
        rspressMode
      />,
    ));

    expect(container.querySelector("details.rspress-container-details > summary")?.textContent)
      .toBe("More information");
    expect(container.querySelector("details")?.textContent).toContain("Hidden body");
    act(() => root.unmount());
  });

  test("leaves Rspress container syntax as text when Rspress mode is disabled", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <MarkdownPreview
        markdown={":::tip\nBody\n:::"}
        baseDir=""
        files={[]}
      />,
    ));

    expect(container.querySelector(".rspress-container")).toBeNull();
    expect(container.textContent).toContain(":::tip");
    act(() => root.unmount());
  });

  test("leaves an unclosed Rspress container unchanged", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <MarkdownPreview
        markdown={":::tip\nBody without a closing marker"}
        baseDir=""
        files={[]}
        rspressMode
      />,
    ));

    expect(container.querySelector(".rspress-container")).toBeNull();
    expect(container.textContent).toContain(":::tip");
    act(() => root.unmount());
  });

  test("reports the Markdown source range when a table is clicked", () => {
    const onEditTable = vi.fn();
    const markdown = "Before\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nAfter";
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <MarkdownPreview
        markdown={markdown}
        baseDir=""
        files={[]}
        onEditTable={onEditTable}
      />,
    ));

    act(() => (container.querySelector("table") as HTMLTableElement).click());

    const start = markdown.indexOf("| A | B |");
    const end = start + "| A | B |\n| --- | --- |\n| 1 | 2 |".length;
    expect(onEditTable).toHaveBeenCalledWith(start, end);
    act(() => root.unmount());
  });

  test("reports the original source range for a Japanese table when TOC is shown", () => {
    const onEditTable = vi.fn();
    const table = [
      "| 用語 | 説明 |",
      "|---|---|",
      "| 認証（Authentication） | 「誰であるか」を確認する処理。ログインできるかどうか |",
      "| 認可（Authorization） | 「何を許可するか」を決める処理。アクセスできるかどうか |",
      "| UserDetailsService | ユーザー名から認証対象ユーザーを取得する処理を切り出したインタフェース |",
      "| DelegatingPasswordEncoder | プレフィックスを見て適切なパスワードエンコーダーを選ぶ仕組み |",
    ].join("\n");
    const markdown = `# Spring Security\n\n${table}\n\nAfter`;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <MarkdownPreview
        markdown={markdown}
        baseDir=""
        files={[]}
        showToc
        onEditTable={onEditTable}
      />,
    ));

    act(() => (container.querySelector("table") as HTMLTableElement).click());

    const start = markdown.indexOf(table);
    expect(onEditTable).toHaveBeenCalledWith(start, start + table.length);
    act(() => root.unmount());
  });

  test("resolves package images and reports a missing image", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <MarkdownPreview
        markdown={"![photo](../images/photo.png)\n\n![missing](../images/missing.png)"}
        baseDir="docs"
        files={[{
          path: "images/photo.png", is_text: false, content: null, base64: "AAAA",
        }]}
      />,
    ));

    expect(container.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,AAAA");
    expect(container.textContent).toContain("画像が見つかりません: ../images/missing.png");
    act(() => root.unmount());
  });

  test("opens a package image full-screen and closes it with Escape", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <MarkdownPreview
        markdown="![photo](images/photo.png)"
        baseDir=""
        files={[{
          path: "images/photo.png", is_text: false, content: null, base64: "AAAA",
        }]}
      />,
    ));

    act(() => (container.querySelector(".markdown-preview img") as HTMLImageElement).click());
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(container.querySelector(".preview-diagram-edit")).toBeNull();
    expect(dialog?.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,AAAA");

    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    act(() => root.unmount());
  });

  test("opens media outside the split editor preview so it fills the window", () => {
    const splitView = document.createElement("div");
    splitView.className = "split-view";
    const container = document.createElement("div");
    splitView.appendChild(container);
    document.body.appendChild(splitView);
    const root = createRoot(container);
    act(() => root.render(
      <MarkdownPreview
        markdown="![photo](images/photo.png)"
        baseDir=""
        files={[{
          path: "images/photo.png", is_text: false, content: null, base64: "AAAA",
        }]}
      />,
    ));

    act(() => (container.querySelector("img") as HTMLImageElement).click());
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(splitView.contains(dialog)).toBe(false);
    act(() => root.unmount());
  });

  test("closes the full-screen image with its close button", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <MarkdownPreview
        markdown="![photo](images/photo.png)"
        baseDir=""
        files={[{
          path: "images/photo.png", is_text: false, content: null, base64: "AAAA",
        }]}
      />,
    ));

    act(() => (container.querySelector(".markdown-preview img") as HTMLImageElement).click());
    act(() => (document.body.querySelector(".preview-media-close") as HTMLButtonElement).click());
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    act(() => root.unmount());
  });

  test("zooms with Ctrl+wheel and pans enlarged media by dragging", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <MarkdownPreview
        markdown="![photo](images/photo.png)"
        baseDir=""
        files={[{
          path: "images/photo.png", is_text: false, content: null, base64: "AAAA",
        }]}
      />,
    ));

    act(() => (container.querySelector(".markdown-preview img") as HTMLImageElement).click());
    const viewport = document.body.querySelector(".preview-media-content") as HTMLDivElement;
    const transform = document.body.querySelector(".preview-media-transform") as HTMLDivElement;

    act(() => viewport.dispatchEvent(new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -100,
      clientX: 400,
      clientY: 300,
    })));
    expect(transform.style.transform).toContain("scale(1.1)");
    const transformAfterZoom = transform.style.transform;

    act(() => viewport.dispatchEvent(new MouseEvent("pointerdown", {
      bubbles: true, button: 0, clientX: 100, clientY: 100,
    })));
    act(() => viewport.dispatchEvent(new MouseEvent("pointermove", {
      bubbles: true, clientX: 130, clientY: 145,
    })));
    act(() => viewport.dispatchEvent(new MouseEvent("pointerup", { bubbles: true })));
    expect(transform.style.transform).not.toBe(transformAfterZoom);
    expect(transform.style.transform).toContain("scale(1.1)");
    act(() => root.unmount());
  });

  test("zooms enlarged media with the mouse wheel without Ctrl", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <MarkdownPreview
        markdown="![photo](images/photo.png)"
        baseDir=""
        files={[{
          path: "images/photo.png", is_text: false, content: null, base64: "AAAA",
        }]}
      />,
    ));

    act(() => (container.querySelector(".markdown-preview img") as HTMLImageElement).click());
    const viewport = document.body.querySelector(".preview-media-content") as HTMLDivElement;
    act(() => viewport.dispatchEvent(new WheelEvent("wheel", {
      bubbles: true, deltaY: -100,
    })));
    expect((document.body.querySelector(".preview-media-transform") as HTMLDivElement).style.transform)
      .toContain("scale(1.1)");
    act(() => root.unmount());
  });

  test("resolves a URL-encoded Japanese image filename", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <MarkdownPreview
        markdown="![](../images/%E5%86%99%E7%9C%9F%201.png)"
        baseDir="docs"
        files={[{
          path: "images/写真 1.png", is_text: false, content: null, base64: "BBBB",
        }]}
      />,
    ));

    expect(container.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,BBBB");
    act(() => root.unmount());
  });

  test("renders a legacy image link whose Japanese filename contains spaces", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <MarkdownPreview
        markdown="![スクリーンショット 2022-01-29 192601](images/スクリーンショット 2022-01-29 192601.png)"
        baseDir=""
        files={[{
          path: "images/スクリーンショット 2022-01-29 192601.png",
          is_text: false, content: null, base64: "CCCC",
        }]}
      />,
    ));

    expect(container.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,CCCC");
    expect(container.textContent).not.toContain("![スクリーンショット");
    act(() => root.unmount());
  });

  test("renders a sanitized drawing SVG and opens its editor on double-click", () => {
    const onEditDrawing = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <MarkdownPreview
        markdown="![drawing](../diagrams/example.svg)"
        baseDir="docs"
        files={[{
          path: "diagrams/example.svg", is_text: true,
          content: '<svg><rect width="10" height="10"/><script>alert(1)</script></svg>',
          base64: null,
        }]}
        manifest={{ resources: [{
          type: "drawing", source: "diagrams/example.draw.json", rendered: "diagrams/example.svg",
        }] }}
        onEditDrawing={onEditDrawing}
      />,
    ));

    const drawing = container.querySelector(".drawing-image") as HTMLDivElement;
    expect(drawing.querySelector("svg")).not.toBeNull();
    expect(drawing.querySelector("script")).toBeNull();
    act(() => drawing.click());
    expect(onEditDrawing).not.toHaveBeenCalled();
    act(() => drawing.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(onEditDrawing).toHaveBeenCalledWith("diagrams/example.draw.json");
    act(() => root.unmount());
  });

  test("shows an Edit button on an editable diagram and opens its editor", () => {
    const onEditDrawing = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <MarkdownPreview
        markdown="![drawing](diagrams/example.svg)"
        baseDir=""
        files={[{
          path: "diagrams/example.svg", is_text: true,
          content: '<svg><rect width="10" height="10"/></svg>', base64: null,
        }]}
        manifest={{ resources: [{
          type: "drawing", source: "diagrams/example.draw.json", rendered: "diagrams/example.svg",
        }] }}
        onEditDrawing={onEditDrawing}
      />,
    ));

    const editButton = container.querySelector(".preview-diagram-edit") as HTMLButtonElement;
    expect(editButton.textContent).toBe("Edit");
    act(() => editButton.click());
    expect(onEditDrawing).toHaveBeenCalledWith("diagrams/example.draw.json");
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    act(() => root.unmount());
  });

  test("opens a preview diagram full-screen on a single click", async () => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <MarkdownPreview
        markdown="![drawing](diagrams/example.svg)"
        baseDir=""
        files={[{
          path: "diagrams/example.svg", is_text: true,
          content: '<svg><rect width="10" height="10"/></svg>', base64: null,
        }]}
      />,
    ));

    act(() => (container.querySelector(".drawing-image") as HTMLSpanElement).click());
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector(".preview-diagram-edit")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(document.body.querySelector('[role="dialog"] .drawing-image svg')).not.toBeNull();
    expect(document.body.querySelector('[role="dialog"] .preview-media-white-background')).not.toBeNull();

    act(() => root.unmount());
    vi.useRealTimers();
  });

  test("opens the diagram editor by double-clicking the full-screen diagram", async () => {
    vi.useFakeTimers();
    const onEditDrawing = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <MarkdownPreview
        markdown="![drawing](diagrams/example.svg)"
        baseDir=""
        files={[{
          path: "diagrams/example.svg", is_text: true,
          content: '<svg><rect width="10" height="10"/></svg>', base64: null,
        }]}
        manifest={{ resources: [{
          type: "drawing", source: "diagrams/example.draw.json", rendered: "diagrams/example.svg",
        }] }}
        onEditDrawing={onEditDrawing}
      />,
    ));

    act(() => (container.querySelector(".preview-diagram") as HTMLSpanElement).click());
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    const viewport = document.body.querySelector(".preview-media-content") as HTMLDivElement;
    const pointerDown = new MouseEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      detail: 1,
    });
    act(() => viewport.dispatchEvent(pointerDown));
    act(() => viewport.dispatchEvent(new MouseEvent("pointerup", { bubbles: true })));
    expect(pointerDown.defaultPrevented).toBe(false);
    act(() => viewport.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));

    expect(onEditDrawing).toHaveBeenCalledWith("diagrams/example.draw.json");
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    act(() => root.unmount());
    vi.useRealTimers();
  });

  test("opens the PlantUML editor when its rendered SVG is double-clicked", () => {
    const onEditPlantUml = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <MarkdownPreview
        markdown="![sequence](diagrams/sequence.svg)"
        baseDir=""
        files={[{
          path: "diagrams/sequence.svg", is_text: true,
          content: '<svg><text>Sequence</text></svg>', base64: null,
        }]}
        manifest={{ resources: [{
          type: "plantuml", source: "diagrams/sequence.puml", rendered: "diagrams/sequence.svg",
        }] }}
        onEditPlantUml={onEditPlantUml}
      />,
    ));

    const diagram = container.querySelector(".drawing-image") as HTMLSpanElement;
    act(() => diagram.click());
    expect(onEditPlantUml).not.toHaveBeenCalled();
    act(() => diagram.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));

    expect(onEditPlantUml).toHaveBeenCalledWith("diagrams/sequence.puml");
    act(() => root.unmount());
  });

  test("opens the Mermaid editor when its rendered SVG is double-clicked", () => {
    const onEditMermaid = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <MarkdownPreview
        markdown="![flow](diagrams/flow.svg)"
        baseDir=""
        files={[{
          path: "diagrams/flow.svg", is_text: true,
          content: '<svg><text>Flow</text></svg>', base64: null,
        }]}
        manifest={{ resources: [{
          type: "mermaid", source: "diagrams/flow.mmd", rendered: "diagrams/flow.svg",
        }] }}
        onEditMermaid={onEditMermaid}
      />,
    ));

    const diagram = container.querySelector(".drawing-image") as HTMLSpanElement;
    act(() => diagram.click());
    expect(onEditMermaid).not.toHaveBeenCalled();
    act(() => diagram.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(onEditMermaid).toHaveBeenCalledWith("diagrams/flow.mmd");
    act(() => root.unmount());
  });

  test("opens the MathJax editor when its rendered SVG is double-clicked", () => {
    const onEditMathJax = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <MarkdownPreview
        markdown="![formula](diagrams/math-1.svg)"
        baseDir=""
        files={[{
          path: "diagrams/math-1.svg", is_text: true,
          content: '<svg><text>x²</text></svg>', base64: null,
        }]}
        manifest={{ resources: [{
          type: "mathjax", source: "diagrams/math-1.tex", rendered: "diagrams/math-1.svg",
        }] }}
        onEditMathJax={onEditMathJax}
      />,
    ));
    const diagram = container.querySelector(".drawing-image") as HTMLSpanElement;
    act(() => diagram.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(onEditMathJax).toHaveBeenCalledWith("diagrams/math-1.tex");
    act(() => root.unmount());
  });

  test("uses a white image background when a MathJax preview is enlarged", () => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <MarkdownPreview
        markdown="![formula](diagrams/math-1.svg)"
        baseDir=""
        files={[{
          path: "diagrams/math-1.svg", is_text: true,
          content: '<svg><text>x²</text></svg>', base64: null,
        }]}
        manifest={{ resources: [{
          type: "mathjax", source: "diagrams/math-1.tex", rendered: "diagrams/math-1.svg",
        }] }}
      />,
    ));

    act(() => (container.querySelector(".drawing-image") as HTMLSpanElement).click());
    act(() => vi.advanceTimersByTime(200));

    expect(document.body.querySelector("[role='dialog'] .preview-media-white-background")).not.toBeNull();
    act(() => root.unmount());
    vi.useRealTimers();
  });

  test.each([
    ["PlantUML", "plantuml", "diagrams/sequence.puml", "diagrams/sequence.svg"],
    ["Mermaid", "mermaid", "diagrams/flow.mmd", "diagrams/flow.svg"],
  ])("uses a white image background when a %s preview is enlarged", (_label, type, source, rendered) => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <MarkdownPreview
        markdown={`![diagram](${rendered})`}
        baseDir=""
        files={[{
          path: rendered, is_text: true,
          content: '<svg><text>diagram</text></svg>', base64: null,
        }]}
        manifest={{ resources: [{ type, source, rendered }] }}
      />,
    ));

    act(() => (container.querySelector(".drawing-image") as HTMLSpanElement).click());
    act(() => vi.advanceTimersByTime(200));

    expect(document.body.querySelector("[role='dialog'] .preview-media-white-background")).not.toBeNull();
    act(() => root.unmount());
    vi.useRealTimers();
  });
});
