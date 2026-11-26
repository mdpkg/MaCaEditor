import { CHACHA_TIMING } from "./chachaSettings";

export interface ChachaGates { enabled: boolean; paused: boolean; blocked: boolean; occupied: boolean }

/** Document-session scope; editor switches clear edits, not rate/duplicate limits. */
export class ChachaTrigger {
  position: number | undefined;
  private editedAt = 0;
  private sentAt = -Infinity;
  private readonly sentKeys = new Set<string>();

  edit(amount: number, position: number, now: number) {
    if (!Number.isFinite(amount) || amount <= 0) return;
    this.editedAt = now; this.position = position;
  }
  resetEdits() { this.position = undefined; }
  delay(now: number): number | null {
    if (this.position === undefined) return null;
    return Math.max(0, this.editedAt + CHACHA_TIMING.idle - now, this.sentAt + CHACHA_TIMING.interval - now);
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
