import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
