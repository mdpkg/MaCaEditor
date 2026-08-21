import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("MarkdownPreview", () => {
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

  test("renders a sanitized drawing SVG and opens its editor", () => {
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
    expect(onEditDrawing).toHaveBeenCalledWith("diagrams/example.draw.json");
    act(() => root.unmount());
  });
});
