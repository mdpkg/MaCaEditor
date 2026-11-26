import type { AiStreamEvent } from "../types";

export type RequestOwner = { documentScopeKey: string; sessionId: string; generation: number; requestId: string };
export type ChatCompletion = { request_id: string; content: string };
type Slot = { owner: RequestOwner; valid: boolean };
let physicalSlot: Slot | undefined;
const listeners = new Set<() => void>();
export const subscribeChatTransport = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const isChatTransportBusy = () => physicalSlot !== undefined;
export const chatRequestOwner = () => physicalSlot?.owner;
const emit = () => listeners.forEach((listener) => listener());

/** The physical slot outlives panels, sessions and document instances. No queue. */
export class ChatTransport {
  private slot?: Slot;
  constructor(
    private readonly invoke: (id: string, deliver: (event: AiStreamEvent) => void) => Promise<ChatCompletion>,
    private readonly cancel: (id: string) => Promise<boolean>,
  ) {}
  get busy() { return physicalSlot !== undefined; }
  invalidate() {
    const slot = this.slot;
    if (!slot || !slot.valid) return;
    slot.valid = false;
    void this.cancel(slot.owner.requestId).catch(() => {});
  }
  async send(owner: RequestOwner, deliver: (event: AiStreamEvent) => void): Promise<ChatCompletion | undefined> {
    if (physicalSlot) throw new Error("chat busy");
    const slot: Slot = { owner: { ...owner }, valid: true };
    physicalSlot = this.slot = slot;
    emit();
    let bytes = 0;
    let overflow = false;
    const size = (text: string) => new TextEncoder().encode(text).byteLength;
    try {
      const result = await this.invoke(owner.requestId, (event) => {
        if (event.type === "delta" && event.request_id === owner.requestId && slot.valid) {
          bytes += size(event.content);
          if (bytes > 64 * 1024) { overflow = true; this.invalidate(); return; }
        }
        if (slot.valid && physicalSlot === slot && event.request_id === owner.requestId &&
            (event.type === "started" || event.type === "delta")) deliver(event);
      });
      if (overflow || size(result.content) > 64 * 1024) throw new Error("chat response exceeds 64 KiB");
      if (result.request_id !== owner.requestId) throw new Error("chat request mismatch");
      return slot.valid ? result : undefined;
    } finally {
      slot.valid = false;
      if (physicalSlot === slot) physicalSlot = undefined;
      if (this.slot === slot) this.slot = undefined;
      emit();
    }
  }
}
