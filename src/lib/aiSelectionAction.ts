import type { AiConfig, AiStreamEvent } from "../types";
import {
  cancelAiRequest,
  loadAiConfig,
  startAiSelectionAction,
} from "./tauri";
import type { AiSelectionSnapshot, AiTaskKind } from "./aiSelection";
import { aiErrorMessage } from "./aiSelection";

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
  private result = "";
  private errorKind: AiStreamEvent["error"]["kind"] | null = null;
  private listeners = new Set<(state: AiStreamState) => void>();

  getState(): AiStreamState {
    return this.state;
  }

  getResult(): string {
    return this.result;
  }

  getErrorKind(): AiStreamEvent["error"]["kind"] | null {
    return this.errorKind;
  }

  getErrorMessage(): string | null {
    return this.errorKind ? aiErrorMessage(this.errorKind) : null;
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
    this.result = "";
    this.errorKind = null;
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
        (event) => this.handleEvent(event),
      );
      this.requestId = requestId;
    } catch {
      this.errorKind = "Unknown";
      this.setState("error");
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
    this.errorKind = null;
    this.requestId = null;
    this.setState("idle");
  }

  private handleEvent(event: AiStreamEvent) {
    switch (event.type) {
      case "delta":
        this.result += event.content;
        break;
      case "completed":
        this.setState("completed");
        break;
      case "cancelled":
        this.setState("cancelled");
        break;
      case "error":
        this.errorKind = event.error.kind;
        this.setState("error");
        break;
      case "started":
        break;
    }
  }
}

export { loadAiConfig };
