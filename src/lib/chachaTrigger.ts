import { CHACHA_FREQUENCIES, type ChachaSettings } from "./chachaSettings";

export interface ChachaGates { enabled: boolean; paused: boolean; blocked: boolean; occupied: boolean }

/** Document-session scope; editor switches clear edits, not rate/duplicate limits. */
export class ChachaTrigger {
  position: number | undefined;
  private edits = 0;
  private editedAt = 0;
  private sentAt = -Infinity;
  private readonly sentKeys = new Set<string>();
  constructor(public frequency: ChachaSettings["frequency"]) {}

  edit(amount: number, position: number, now: number) {
    if (!Number.isFinite(amount) || amount <= 0) return;
    this.edits = Math.min(1000000, this.edits + amount);
    this.editedAt = now; this.position = position;
  }
  resetEdits() { this.edits = 0; this.position = undefined; }
  delay(now: number): number | null {
    const preset = CHACHA_FREQUENCIES[this.frequency];
    if (this.position === undefined || this.edits < preset.edits) return null;
    return Math.max(0, this.editedAt + preset.idle - now, this.sentAt + preset.interval - now);
  }
  ready(now: number, gates: ChachaGates): boolean {
    return gates.enabled && !gates.paused && !gates.blocked && !gates.occupied && this.delay(now) === 0;
  }
  seen(file: string, key: string): boolean { return this.sentKeys.has(JSON.stringify([file, key])); }
  sent(file: string, key: string, now: number) {
    this.sentAt = now; this.resetEdits();
    this.sentKeys.add(JSON.stringify([file, key]));
    while (this.sentKeys.size > 128) this.sentKeys.delete(this.sentKeys.values().next().value!);
  }
}
