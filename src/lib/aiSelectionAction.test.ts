import { beforeEach, describe, expect, test, vi } from "vitest";
import { AiSelectionActionService } from "./aiSelectionAction";
import type { AiConfig, AiStreamEvent } from "../types";
import type { AiSelectionSnapshot } from "./aiSelection";

vi.mock("./tauri", async () => {
  const actual = await vi.importActual<typeof import("./tauri")>("./tauri");
  return {
    ...actual,
    startAiSelectionAction: vi.fn(),
    cancelAiRequest: vi.fn(),
  };
});

import { cancelAiRequest, startAiSelectionAction } from "./tauri";

const startMock = startAiSelectionAction as unknown as ReturnType<typeof vi.fn>;
const cancelMock = cancelAiRequest as unknown as ReturnType<typeof vi.fn>;

const config: AiConfig = {
  provider: "OpenAiCompatible",
  base_url: "http://localhost:11434/v1",
  api_key: null,
  model: "qwen2.5",
  temperature: 0.7,
  max_output_tokens: 4096,
  connect_timeout_seconds: 10,
  request_timeout_seconds: 300,
};

const snapshot: AiSelectionSnapshot = { from: 0, to: 3, text: "abc" };

function emit(event: AiStreamEvent) {
  const calls = startMock.mock.calls;
  const call = calls[calls.length - 1]!;
  const onEvent = call[1];
  onEvent(event);
}

beforeEach(() => {
  startMock.mockReset();
  cancelMock.mockReset();
});

describe("AiSelectionActionService", () => {
  test("runs a task with the selected text", async () => {
    startMock.mockImplementation(async () => "r1");
    const service = new AiSelectionActionService();
    await service.run(config, "Rewrite", snapshot);
    expect(startMock).toHaveBeenCalledWith(
      expect.objectContaining({ task: "Rewrite", selectedText: "abc" }),
      expect.any(Function),
    );
  });

  test("accumulates deltas and completes", async () => {
    startMock.mockImplementation(async () => "r1");
    const service = new AiSelectionActionService();
    const states: string[] = [];
    service.subscribe((s) => states.push(s));
    await service.run(config, "Rewrite", snapshot);
    emit({ type: "delta", request_id: "r1", content: "he" });
    emit({ type: "delta", request_id: "r1", content: "llo" });
    emit({ type: "completed", request_id: "r1" });
    expect(service.getResult()).toBe("hello");
    expect(service.getState()).toBe("completed");
    expect(service.canApply()).toBe(true);
    expect(states).toContain("running");
    expect(states).toContain("completed");
  });

  test("cannot apply after cancel", async () => {
    startMock.mockImplementation(async () => "r1");
    cancelMock.mockImplementation(async () => true);
    const service = new AiSelectionActionService();
    await service.run(config, "Rewrite", snapshot);
    emit({ type: "delta", request_id: "r1", content: "partial" });
    await service.cancel();
    expect(service.getState()).toBe("cancelled");
    expect(service.canApply()).toBe(false);
    expect(cancelMock).toHaveBeenCalledWith("r1");
  });

  test("cannot start a second action while running", async () => {
    startMock.mockImplementation(async () => "r1");
    const service = new AiSelectionActionService();
    await service.run(config, "Rewrite", snapshot);
    await service.run(config, "Summarize", snapshot);
    expect(startMock).toHaveBeenCalledTimes(1);
  });

  test("preserves an error and discards partial text even if completion arrives", async () => {
    startMock.mockImplementation(async () => "r1");
    const service = new AiSelectionActionService();
    await service.run(config, "Summarize", snapshot);
    emit({ type: "delta", request_id: "r1", content: "partial" });
    emit({ type: "error", request_id: "r1", error: { kind: "Timeout", message: "slow" } });
    emit({ type: "completed", request_id: "r1" });
    expect(service.getState()).toBe("error");
    expect(service.getError()).toEqual({ kind: "Timeout", message: "slow" });
    expect(service.getResult()).toBe("");
    expect(service.canApply()).toBe(false);

    const oldHandler = startMock.mock.calls[0]![1];
    startMock.mockResolvedValueOnce("r2");
    await service.run(config, "Summarize", snapshot);
    oldHandler({ type: "completed", request_id: "r1" });
    emit({ type: "delta", request_id: "r2", content: "summary" });
    emit({ type: "completed", request_id: "r2" });
    expect(service.canApply()).toBe(true);
    expect(service.getResult()).toBe("summary");
  });

  test.each(["", " \n  "])("rejects a blank completed result %j", async (content) => {
    startMock.mockResolvedValueOnce("r1");
    const service = new AiSelectionActionService();
    await service.run(config, "Summarize", snapshot);
    emit({ type: "delta", request_id: "r1", content });
    emit({ type: "completed", request_id: "r1" });
    expect(service.getState()).toBe("error");
    expect(service.getError()).toEqual({ kind: "InvalidResponse", message: "empty response" });
    expect(service.canApply()).toBe(false);
  });

  test("preserves the error when starting the request fails", async () => {
    const error = { kind: "AuthenticationFailed", message: "upstream denied the request" };
    startMock.mockRejectedValueOnce(error);
    const service = new AiSelectionActionService();
    await service.run(config, "Rewrite", snapshot);
    expect(service.getState()).toBe("error");
    expect(service.getError()).toEqual(error);
  });

  test("discard resets to idle", async () => {
    startMock.mockImplementation(async () => "r1");
    const service = new AiSelectionActionService();
    await service.run(config, "Rewrite", snapshot);
    emit({ type: "delta", request_id: "r1", content: "x" });
    emit({ type: "completed", request_id: "r1" });
    service.discard();
    expect(service.getState()).toBe("idle");
    expect(service.getResult()).toBe("");
  });
});
