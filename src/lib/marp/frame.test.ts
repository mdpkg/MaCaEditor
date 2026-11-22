import { expect, test } from "vitest";
import { createFrameShell, readFrameMessage } from "./frame";

test("isolates the fixed helper with nonce CSP and no external access", () => {
  const shell = createFrameShell("session");
  expect(shell).toContain("default-src 'none'");
  expect(shell).toContain("connect-src 'none'");
  expect(shell).toContain("img-src data:");
  expect(shell).toMatch(/script-src 'nonce-[a-f0-9]+'/);
  expect(shell).not.toContain("https:");
});

test("accepts only the current frame, session, generation and bounded messages", () => {
  const source = {} as Window;
  const data = { channel: "maca-marp", session: "s", generation: 3, type: "slide", index: 1 };
  const read = (value: unknown, from = source) => readFrameMessage({ data: value, source: from } as MessageEvent, source, "s", 3, 2);
  expect(read(data)).toEqual(data);
  expect(read(data, {} as Window)).toBeNull();
  for (const changes of [{ session: "old" }, { generation: 2 }, { type: "invoke" }, { index: -1 }, { index: 2 }, { index: 0.5 }]) {
    expect(read({ ...data, ...changes })).toBeNull();
  }
  expect(read({ ...data, type: "link", href: "x".repeat(4097) })).toBeNull();
  expect(read({ ...data, type: "link", href: "javascript:alert(1)" })).toBeNull();
  expect(read({ ...data, type: "link", href: "file:///secret" })).toBeNull();
});
