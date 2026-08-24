import { describe, expect, test, vi } from "vitest";
import type { AiConfig, AiStreamEvent } from "../types";
import { AiDiagramEditService } from "./aiDiagramEdit";

const config: AiConfig = { provider: "OpenAiCompatible", base_url: "http://localhost", api_key: null, model: "mock", temperature: null, max_output_tokens: null, connect_timeout_seconds: null, request_timeout_seconds: null };

function harness() {
  let emit: ((event: AiStreamEvent) => void) | null = null;
  const start = vi.fn(async (_options, onEvent) => { emit = onEvent; return "request-1"; });
  const cancel = vi.fn(async () => true);
  const service = new AiDiagramEditService({ start, cancel });
  return { service, start, cancel, send: (event: AiStreamEvent) => emit?.(event) };
}

describe("AiDiagramEditService", () => {
  test.each(["", "   ", "\n"])("does not start for an empty instruction", async (instruction) => {
    const { service, start } = harness();
    expect(await service.run(config, "plantuml", "@startuml\n@enduml", instruction)).toBe(false);
    expect(start).not.toHaveBeenCalled();
    expect(service.getState().status).toBe("idle");
  });

  test("accumulates source and normalizes only on completion", async () => {
    const { service, send } = harness();
    const current = "@startuml\nA -> B\n@enduml";
    await service.run(config, "plantuml", current, "Add C");
    send({ type: "delta", request_id: "request-1", content: "```plantuml\n@startuml\n" });
    send({ type: "delta", request_id: "request-1", content: "A -> C\n@enduml\n```" });
    expect(service.getState()).toMatchObject({ status: "running", result: "```plantuml\n@startuml\nA -> C\n@enduml\n```" });
    expect(current).toBe("@startuml\nA -> B\n@enduml");
    send({ type: "completed", request_id: "request-1" });
    expect(service.getState()).toMatchObject({ status: "completed", result: "@startuml\nA -> C\n@enduml" });
  });

  test("cancel calls backend and ignores late events", async () => {
    const { service, cancel, send } = harness();
    await service.run(config, "mermaid", "flowchart LR\nA --> B", "Add C");
    await service.cancel();
    expect(cancel).toHaveBeenCalledWith("request-1");
    send({ type: "delta", request_id: "request-1", content: "stale" });
    send({ type: "completed", request_id: "request-1" });
    expect(service.getState()).toMatchObject({ status: "cancelled", result: "" });
  });

  test("a retry receives the latest editor source", async () => {
    const { service, start, send } = harness();
    await service.run(config, "mermaid", "flowchart LR\nA --> B", "Add C");
    send({ type: "error", request_id: "request-1", error: { kind: "ServerError", message: "failed" } });
    await service.run(config, "mermaid", "flowchart LR\nA --> D", "Add C");
    expect(start.mock.calls[1][0].currentSource).toBe("flowchart LR\nA --> D");
  });
});
