import type { AiConfig, AiError, AiStreamEvent } from "../types";
import {
  cancelAiRequest,
  loadAiConfig,
  startAiSelectionAction,
} from "./tauri";
import type { AiSelectionSnapshot, AiTaskKind } from "./aiSelection";
import { readAiError } from "./aiSelection";

/// ストリーミングの状態。
export type AiStreamState =
  | "idle"
  | "running"
  | "completed"
  | "cancelled"
  | "error";

/// 1 つの AI Selection Action の実行を管理するサービス。
/// selection 取得・stream state・apply をここで分離する。
export class AiSelectionActionService {
  private state: AiStreamState = "idle";
  private requestId: string | null = null;
  private runId = 0;
  private result = "";
  private error: AiError | null = null;
  private listeners = new Set<(state: AiStreamState) => void>();

  getState(): AiStreamState {
    return this.state;
  }

  getResult(): string {
    return this.result;
  }

  getError(): AiError | null {
    return this.error;
  }

  isRunning(): boolean {
    return this.state === "running";
  }

  canApply(): boolean {
    return this.state === "completed";
  }

  subscribe(listener: (state: AiStreamState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setState(next: AiStreamState) {
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }

  async run(
    config: AiConfig,
    task: AiTaskKind,
    snapshot: AiSelectionSnapshot,
  ): Promise<void> {
    if (this.isRunning()) return;
    const runId = ++this.runId;
    this.result = "";
    this.error = null;
    this.requestId = null;
    this.setState("running");
    try {
      const requestId = await startAiSelectionAction(
        {
          baseUrl: config.base_url,
          apiKey: config.api_key,
          model: config.model,
          task,
          selectedText: snapshot.text,
          connectTimeoutSeconds: config.connect_timeout_seconds ?? null,
          requestTimeoutSeconds: config.request_timeout_seconds ?? null,
        },
        (event) => {
          if (runId === this.runId && this.isRunning()) this.handleEvent(event);
        },
      );
      if (runId === this.runId && this.isRunning()) this.requestId = requestId;
    } catch (reason) {
      if (runId === this.runId && this.isRunning()) this.fail(reason);
    }
  }

  async cancel(): Promise<void> {
    if (!this.isRunning()) return;
    if (this.requestId) {
      await cancelAiRequest(this.requestId);
    }
    this.setState("cancelled");
  }

  discard() {
    this.result = "";
    this.error = null;
    this.requestId = null;
    this.setState("idle");
  }

  private fail(reason: unknown) {
    this.result = "";
    this.error = readAiError(reason);
    this.setState("error");
  }

  private handleEvent(event: AiStreamEvent) {
    switch (event.type) {
      case "delta":
        this.result += event.content;
        break;
      case "completed":
        if (this.result.trim()) {
          this.setState("completed");
        } else {
          this.fail({ kind: "InvalidResponse", message: "empty response" });
        }
        break;
      case "cancelled":
        this.setState("cancelled");
        break;
      case "error":
        this.fail(event.error);
        break;
      case "started":
        this.requestId = event.request_id;
        break;
    }
  }
}

export { loadAiConfig };
