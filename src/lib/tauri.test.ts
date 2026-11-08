import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  cancelAiRequest,
  openPackage,
  savePackage,
  saveFolder,
  startAiDocumentChat,
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

describe("startAiDocumentChat", () => {
  test("sends current editor document and conversation to the dedicated command", async () => {
    invokeMock.mockResolvedValue("chat-1");
    const requestId = await startAiDocumentChat({
      baseUrl: "http://localhost:11434/v1", apiKey: null, model: "qwen",
      filename: "README.md", currentDocument: "unsaved BBB",
      history: [{ role: "User", content: "first" }], question: "next",
    }, () => {});
    expect(requestId).toBe("chat-1");
    expect(invokeMock).toHaveBeenCalledWith("ai_document_chat", expect.objectContaining({
      filename: "README.md", currentDocument: "unsaved BBB", question: "next",
      history: [{ role: "User", content: "first" }],
    }));
  });
});

describe("large edit history transfer", () => {
  const request = {
    path: "document", manifest: {}, files: [],
    edit_history: { data: "checkpoint", attachments: ["QUJD".repeat(5 * 2 ** 20), "ZGVmZw=="] },
  };

  test.each([["save_package", savePackage], ["save_folder", saveFolder]] as const)(
    "streams attachment bytes before %s and keeps the checkpoint metadata with the document save",
    async (command, save) => {
      invokeMock.mockImplementation(async (name: string) => name === "begin_edit_history_upload" ? "upload" : {});
      await save({ ...request, original_paths: [], expected_revision: "baseline" });
      const calls = invokeMock.mock.calls;
      expect(calls[0]).toEqual(["begin_edit_history_upload", { sizes: [15 * 2 ** 20, 4] }]);
      const chunks = calls.filter(([name]) => name === "upload_edit_history_chunk");
      expect(chunks.map(([, data]) => data.byteLength)).toEqual([3 * 2 ** 20, 4, ...Array(4).fill(3 * 2 ** 20)]);
      expect(Array.from(chunks[0][1].slice(0, 3))).toEqual([65, 66, 67]);
      expect(chunks[1][2].headers).toMatchObject({ "x-history-upload": "upload", "x-history-index": "1", "x-history-offset": "0" });
      expect(calls[calls.length - 2]).toEqual([command, expect.objectContaining({
        editHistoryUpload: "upload", request: expect.objectContaining({ edit_history: { data: "checkpoint", attachments: [] } }),
      })]);
      expect(calls[calls.length - 1]).toEqual(["discard_edit_history_upload", { token: "upload" }]);
    },
  );

  test("still saves the document when a history upload fails", async () => {
    invokeMock.mockImplementation(async (name: string) => {
      if (name === "begin_edit_history_upload") return "upload";
      if (name === "upload_edit_history_chunk") throw new Error("upload failed");
      return {};
    });
    const outcome = await savePackage(request);
    expect(outcome.edit_history_warning).toContain("upload failed");
    expect(invokeMock.mock.calls.map(([name]) => name)).toEqual([
      "begin_edit_history_upload", "upload_edit_history_chunk", "upload_edit_history_chunk", "discard_edit_history_upload", "save_package",
    ]);
    expect(invokeMock.mock.lastCall![1].request.edit_history).toBeUndefined();
  });

  test("reassembles attachment bytes before returning a reopened document", async () => {
    const info = {
      entrypoint: "index.md", files: [], manifest: {},
      edit_history: { data: "checkpoint", attachments: [] },
      edit_history_download: { id: 42, sizes: [3 * 2 ** 20 + 1, 0] },
    };
    invokeMock.mockImplementation(async (name: string, args) => {
      if (name === "open_package") return info;
      if (args.offset === 0) return new Uint8Array(3 * 2 ** 20).buffer;
      return Uint8Array.of(65).buffer;
    });
    const result = await openPackage("document");
    expect(result.edit_history?.attachments[0] === "A".repeat(4 * 2 ** 20) + "QQ==").toBe(true);
    expect(result.edit_history?.attachments[1]).toBe("");
    expect(invokeMock.mock.calls.slice(1).map(([, args]) => args)).toEqual([
      { id: 42, index: 0, offset: 0 }, { id: 42, index: 0, offset: 3 * 2 ** 20 },
    ]);
  });

  test("keeps the document readable when attachment download is incomplete", async () => {
    invokeMock.mockResolvedValueOnce({
      entrypoint: "index.md", files: [], manifest: {},
      edit_history: { data: "checkpoint", attachments: [] },
      edit_history_download: { id: 42, sizes: [3] },
    }).mockResolvedValueOnce(Uint8Array.of(1, 2).buffer);
    const result = await openPackage("document");
    expect(result.entrypoint).toBe("index.md");
    expect(result.edit_history).toBeUndefined();
    expect(result.edit_history_warning).toContain("Incomplete");
  });
});
