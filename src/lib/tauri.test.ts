import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  cancelAiRequest,
  startAiStream,
} from "./tauri";
import type { AiStreamEvent } from "../types";

vi.mock("@tauri-apps/api/core", async () => {
  const actual = await vi.importActual<typeof import("@tauri-apps/api/core")>(
    "@tauri-apps/api/core"
  );
  return {
    ...actual,
    invoke: vi.fn(),
  };
});

import { invoke } from "@tauri-apps/api/core";

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

// Channel 生成時に window.__TAURI_INTERNALS__.transformCallback が必要。
// ここでコールバックを捕捉し、テストから直接呼べるようにする。
let channelCallback: ((raw: { message: AiStreamEvent; index: number }) => void) | null =
  null;
let nextIndex = 0;

beforeEach(() => {
  invokeMock.mockReset();
  channelCallback = null;
  nextIndex = 0;
  (globalThis as typeof globalThis & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
    transformCallback: (cb: (raw: { message: AiStreamEvent; index: number }) => void) => {
      channelCallback = cb;
      return 1;
    },
    unregisterCallback: () => {},
  };
});

function emitChannelEvent(event: AiStreamEvent) {
  const cb = channelCallback;
  expect(cb).toBeTypeOf("function");
  (cb as (raw: { message: AiStreamEvent; index: number }) => void)({
    message: event,
    index: nextIndex++,
  });
}

describe("startAiStream", () => {
  test("invokes ai_stream with channel and returns request id", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "ai_stream") {
        emitChannelEvent({ type: "started", request_id: "r1" });
        return "r1";
      }
      return undefined;
    });

    const events: AiStreamEvent[] = [];
    const requestId = await startAiStream(
      {
        baseUrl: "http://localhost:11434/v1",
        apiKey: null,
        model: "qwen2.5",
        request: { messages: [{ role: "User", content: "hi" }] },
      },
      (e) => events.push(e)
    );

    expect(requestId).toBe("r1");
    expect(events[0]).toMatchObject({ type: "started", request_id: "r1" });
    expect(invokeMock).toHaveBeenCalledWith(
      "ai_stream",
      expect.objectContaining({ model: "qwen2.5" })
    );
  });

  test("forwards delta events by request id", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "ai_stream") {
        emitChannelEvent({ type: "delta", request_id: "r1", content: "he" });
        emitChannelEvent({ type: "delta", request_id: "r1", content: "llo" });
        return "r1";
      }
      return undefined;
    });

    const events: AiStreamEvent[] = [];
    await startAiStream(
      {
        baseUrl: "http://localhost:11434/v1",
        apiKey: null,
        model: "qwen2.5",
        request: { messages: [{ role: "User", content: "hi" }] },
      },
      (e) => events.push(e)
    );

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: "delta", request_id: "r1", content: "he" });
    expect(events[1]).toMatchObject({ type: "delta", request_id: "r1", content: "llo" });
  });

  test("forwards error events", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "ai_stream") {
        emitChannelEvent({
          type: "error",
          request_id: "r1",
          error: { kind: "ConnectionFailed", message: "boom" },
        });
        return "r1";
      }
      return undefined;
    });

    const events: AiStreamEvent[] = [];
    await startAiStream(
      {
        baseUrl: "http://localhost:11434/v1",
        apiKey: null,
        model: "qwen2.5",
        request: { messages: [{ role: "User", content: "hi" }] },
      },
      (e) => events.push(e)
    );

    expect(events[0]).toMatchObject({
      type: "error",
      request_id: "r1",
      error: { kind: "ConnectionFailed" },
    });
  });

  test("forwards completed and cancelled events", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "ai_stream") {
        emitChannelEvent({ type: "completed", request_id: "r1" });
        emitChannelEvent({ type: "cancelled", request_id: "r1" });
        return "r1";
      }
      return undefined;
    });

    const events: AiStreamEvent[] = [];
    await startAiStream(
      {
        baseUrl: "http://localhost:11434/v1",
        apiKey: null,
        model: "qwen2.5",
        request: { messages: [{ role: "User", content: "hi" }] },
      },
      (e) => events.push(e)
    );

    expect(events[0]).toMatchObject({ type: "completed", request_id: "r1" });
    expect(events[1]).toMatchObject({ type: "cancelled", request_id: "r1" });
  });

  test("passes timeout settings to ai_stream", async () => {
    invokeMock.mockResolvedValue("r1");
    await startAiStream(
      {
        baseUrl: "http://localhost:11434/v1",
        apiKey: null,
        model: "qwen2.5",
        request: { messages: [{ role: "User", content: "hi" }] },
        connectTimeoutSeconds: 10,
        requestTimeoutSeconds: 300,
      },
      () => {}
    );

    expect(invokeMock).toHaveBeenCalledWith(
      "ai_stream",
      expect.objectContaining({
        connectTimeoutSeconds: 10,
        requestTimeoutSeconds: 300,
      })
    );
  });
});

describe("cancelAiRequest", () => {
  test("invokes cancel_ai_request with request id", async () => {
    invokeMock.mockResolvedValue(true);
    const result = await cancelAiRequest("r1");
    expect(result).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("cancel_ai_request", {
      requestId: "r1",
    });
  });
});
