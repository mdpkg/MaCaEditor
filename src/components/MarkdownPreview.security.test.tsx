import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";
import { vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test.each([
  "java\tscript:window.__probe=true", "java%09script:window.__probe=true",
  "java%0Ascript:window.__probe=true", " javascript:window.__probe=true",
  "java%0Dscript:window.__probe=true", "javascript:window.__probe=true",
  "java%2509script:window.__probe=true", "%256aavascript:window.__probe=true",
  "JaVaScRiPt:window.__probe=true", "data:text/html,payload", "vbscript:payload",
  "file:///secret", "blob:http://127.0.0.1/id", "//127.0.0.1/path",
])("rejects dangerous Markdown destination %s", (url) => {
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    act(() => root.render(<MarkdownPreview markdown={`[probe](<${url}>)`} baseDir="" files={[]} />));
    const link = host.querySelector("a")!;
    expect(link).not.toBeNull();
    expect(link.getAttribute("href")).toBe("#");
    expect(link.protocol).not.toBe("javascript:");
  } finally { act(() => root.unmount()); }
});

test("resolves nested encoded package links once, retaining query and fragment", () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const navigate = vi.fn();
  const download = vi.fn();
  const files = [
    { path: "guide/日本語 file.md", is_text: true, content: "# Guide", base64: null },
    { path: "attachments/仕様 file.txt", is_text: true, content: "notes", base64: null },
  ];
  act(() => root.render(<MarkdownPreview baseDir="docs" files={files}
    onNavigateMarkdown={navigate} onDownloadAttachment={download}
    markdown={'[guide](../guide/%E6%97%A5%E6%9C%AC%E8%AA%9E%20file.md?q=1#part)\n\n[attachment](<../attachments/仕様 file.txt>)\n\n[relative](images/a%20b.png?q=1#part)\n\n[anchor](#part)\n\n[https](https://127.0.0.1/a?q=1#part)\n\n[http](http://127.0.0.1/a)\n\n[mail](mailto:test@example.invalid)\n\n[escape](../../secret.md)'} />));
  try {
    const links = [...host.querySelectorAll("a")];
    act(() => links[0].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    act(() => links[1].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    expect(navigate).toHaveBeenCalledWith(files[0].path);
    expect(download).toHaveBeenCalledWith(files[1]);
    expect(links.slice(2).map((link) => link.getAttribute("href"))).toEqual([
      "docs/images/a%20b.png?q=1#part", "#part", "https://127.0.0.1/a?q=1#part",
      "http://127.0.0.1/a", "mailto:test@example.invalid", "#",
    ]);
  } finally { act(() => root.unmount()); }
});
