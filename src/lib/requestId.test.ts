import { expect, test, vi } from "vitest";
import { createRequestId } from "./requestId";
test("WebViews without randomUUID still issue distinct RFC 4122 UUIDs before IPC", () => {
  let next = 0;
  vi.stubGlobal("crypto", { getRandomValues(array: Uint8Array) { array.fill(++next); return array; } });
  try {
    const first = createRequestId(), second = createRequestId();
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(first === second).toBe(false);
  } finally { vi.unstubAllGlobals(); }
});
