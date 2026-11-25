import { invoke } from "@tauri-apps/api/core";
import type { ChachaTransport } from "./chachaSession";

export interface ChachaConnection { endpoint: string; model: string; revision: string }
export const loadChachaConnection = () => invoke<ChachaConnection>("chacha_connection");

export async function requestChacha({ requestId, messages, signal, connectionRevision }: Parameters<ChachaTransport>[0] & { connectionRevision: string }): Promise<string> {
  if (signal.aborted) throw { kind: "cancelled" };
  const cancel = () => { void invoke("cancel_ai_request", { requestId }).catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    return await invoke<string>("ai_chacha", { requestId, expectedConnection: connectionRevision, request: { messages, max_output_tokens: 256, temperature: null } });
  } finally { signal.removeEventListener("abort", cancel); }
}
