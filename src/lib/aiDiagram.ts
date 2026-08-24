import type { AiConfig, AiStreamEvent } from "../types";
import { cancelAiRequest, startAiDiagramGeneration } from "./tauri";

export type DiagramFormat = "plantuml" | "mermaid";
export type DiagramIntent = "auto" | "sequence" | "flowchart";
export type GeneratedDiagram = { format: DiagramFormat; source: string; intent: DiagramIntent };

export function normalizeDiagramSource(value: string, format: DiagramFormat): string {
  const trimmed = value.trim();
  const language = format === "plantuml" ? "(?:plantuml|puml)" : "mermaid";
  const fence = "`".repeat(3);
  const match = trimmed.match(new RegExp(`^${fence}${language}\\s*\\n([\\s\\S]*?)\\n${fence}$`, "i"));
  return (match ? match[1] : trimmed).trim();
}

export class AiDiagramGenerationService {
  private requestId: string | null = null;
  private generation = 0;
  private result = "";
  private status: "idle" | "running" | "completed" | "cancelled" | "error" = "idle";
  private errorKind: string | null = null;
  private listeners = new Set<() => void>();
  getState() { return { status: this.status, result: this.result, errorKind: this.errorKind }; }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit() { this.listeners.forEach((listener) => listener()); }
  async run(config: AiConfig, format: DiagramFormat, intent: DiagramIntent, markdown: string) {
    if (this.status === "running") return;
    const generation = ++this.generation;
    this.status = "running"; this.result = ""; this.errorKind = null; this.requestId = null; this.emit();
    try {
      this.requestId = await startAiDiagramGeneration({
        baseUrl: config.base_url, apiKey: config.api_key, model: config.model, format, intent, markdown,
        connectTimeoutSeconds: config.connect_timeout_seconds, requestTimeoutSeconds: config.request_timeout_seconds,
      }, (event) => this.handle(event, generation, format));
    } catch { if (generation === this.generation) { this.status = "error"; this.errorKind = "Unknown"; this.emit(); } }
  }
  async cancel() {
    if (this.status !== "running") return;
    ++this.generation;
    if (this.requestId) await cancelAiRequest(this.requestId);
    this.status = "cancelled"; this.emit();
  }
  private handle(event: AiStreamEvent, generation: number, format: DiagramFormat) {
    if (generation !== this.generation || this.status !== "running") return;
    if (event.type === "delta") this.result += event.content;
    else if (event.type === "completed") { this.result = normalizeDiagramSource(this.result, format); this.status = "completed"; }
    else if (event.type === "cancelled") this.status = "cancelled";
    else if (event.type === "error") { this.status = "error"; this.errorKind = event.error.kind; }
    this.emit();
  }
}
