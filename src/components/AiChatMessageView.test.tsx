import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import { AiChatMessageView } from "./AiChatMessageView";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
test("untrusted chat Markdown cannot load images or execute HTML and only safe explicit links are enabled", () => {
  const host = document.createElement("div"), root = createRoot(host);
  act(() => root.render(<AiChatMessageView starting={false} message={{ id: "one", role: "assistant", status: "complete",
    content: '![remote](https://image.invalid/pixel) <img src=x onerror=alert(1)>\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1)) [file](file:///C:/secret) [safe](https://example.test/reader)' }} />));
  expect(host.querySelector("img,script,iframe,object")).toBeNull();
  expect([...host.querySelectorAll("a")].map((link) => link.href)).toEqual(["https://example.test/reader"]);
  expect(host.querySelector("a")?.rel).toBe("noopener noreferrer");
  act(() => root.unmount());
});
