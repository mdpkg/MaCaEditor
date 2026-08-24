import type { AiConfig, AiStreamEvent } from "../types";
import { normalizeDiagramSource, type DiagramFormat } from "./aiDiagram";
import { cancelAiRequest, startAiDiagramEdit } from "./tauri";

type StartOptions = {
  baseUrl: string; apiKey: string | null; model: string; format: DiagramFormat;
  currentSource: string; instruction: string;
  connectTimeoutSeconds?: number | null; requestTimeoutSeconds?: number | null;
};
type Dependencies = {
  start: (options: StartOptions, onEvent: (event: AiStreamEvent) => void) => Promise<string>;
  cancel: (requestId: string) => Promise<boolean>;
};
export type AiDiagramEditStatus = "idle" | "running" | "completed" | "cancelled" | "error";

export class AiDiagramEditService {
  private status: AiDiagramEditStatus = "idle";
  private result = "";
  private errorKind: string | null = null;
  private requestId: string | null = null;
  private generation = 0;
  private listeners = new Set<() => void>();
  constructor(private dependencies: Dependencies = { start: startAiDiagramEdit, cancel: cancelAiRequest }) {}
  getState() { return { status: this.status, result: this.result, errorKind: this.errorKind }; }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit() { this.listeners.forEach((listener) => listener()); }
  async run(config: AiConfig, format: DiagramFormat, currentSource: string, instruction: string): Promise<boolean> {
    if (!instruction.trim() || this.status === "running") return false;
    const generation = ++this.generation;
    this.status = "running"; this.result = ""; this.errorKind = null; this.requestId = null; this.emit();
    try {
      this.requestId = await this.dependencies.start({ baseUrl: config.base_url, apiKey: config.api_key,
        model: config.model, format, currentSource, instruction: instruction.trim(),
        connectTimeoutSeconds: config.connect_timeout_seconds, requestTimeoutSeconds: config.request_timeout_seconds,
      }, (event) => this.handle(event, generation, format));
      return true;
    } catch { if (generation === this.generation) { this.status = "error"; this.errorKind = "Unknown"; this.emit(); } return false; }
  }
  async cancel() {
    if (this.status !== "running") return;
    ++this.generation;
    if (this.requestId) await this.dependencies.cancel(this.requestId);
    this.status = "cancelled"; this.result = ""; this.emit();
  }
  discard() { ++this.generation; this.status = "idle"; this.result = ""; this.errorKind = null; this.requestId = null; this.emit(); }
  private handle(event: AiStreamEvent, generation: number, format: DiagramFormat) {
    if (generation !== this.generation || this.status !== "running") return;
    if (event.type === "delta") this.result += event.content;
    else if (event.type === "completed") { this.result = normalizeDiagramSource(this.result, format); this.status = "completed"; }
    else if (event.type === "cancelled") { this.status = "cancelled"; this.result = ""; }
    else if (event.type === "error") { this.status = "error"; this.errorKind = event.error.kind; }
    this.emit();
  }
}
