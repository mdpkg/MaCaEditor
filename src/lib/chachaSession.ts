import type { ChangeDesc } from "@codemirror/state";
import type { AiMessage } from "../types";
import { extractChachaContext, type ChachaContext } from "./chachaContext";
import { mapChachaContext } from "./chachaAnchor";
import type { ChachaEdit } from "./chachaEdits";
import { parseChachaResponse, type ChachaComment } from "./chachaResponse";
import { buildChachaMessages, CHACHA_FREQUENCIES, normalizeChachaSettings, type ChachaSettings } from "./chachaSettings";
import { ChachaTrigger } from "./chachaTrigger";

export type ChachaTransport = (request: { requestId: string; messages: AiMessage[]; signal: AbortSignal }) => Promise<string>;
interface Binding { file: string; source(): string; blocked(): boolean; visible(position: number): boolean; targetEdited?(context: ChachaContext): boolean }
function requestId(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function mayChangeStructure(before: string, after: string, changes: ChangeDesc): boolean {
  let structural = false;
  changes.iterChangedRanges((from, to, fromNew, toNew) => {
    const start = from === 0 ? 0 : before.lastIndexOf("\n", from - 1) + 1;
    const end = before.indexOf("\n", from), line = before.slice(start, end < 0 ? undefined : end);
    const indent = /^\s*/.exec(line)![0].length;
    structural ||= /[\r\n`~#<>*_=+\[\]\-]/.test(before.slice(from, to) + after.slice(fromNew, toNew))
      || !line.trim() || /^\s*[<#`~>]/.test(line) || (indent >= 4 && from <= start + indent);
  });
  return structural;
}
export interface ChachaSnapshot {
  enabled: boolean; paused: boolean; reason: "auth" | "rate" | "failures" | "manual" | "connection" | null;
  phase: "idle" | "requesting" | "pending" | "collapsed" | "expanded";
  comment?: ChachaComment & { context: ChachaContext };
}

/** One instance per open document session, never part of DocumentState/history. */
export class ChachaSession {
  snapshot: ChachaSnapshot = { enabled: false, paused: false, reason: null, phase: "idle" };
  private readonly trigger: ChachaTrigger;
  private binding?: Binding;
  private settings: ChachaSettings;
  private context?: ChachaContext;
  private contextSource?: string;
  private abort?: AbortController;
  private generation = 0;
  private transportGeneration?: number;
  private revision = 0;
  private deadline = Infinity;
  private lastEdit = -Infinity;
  private retryUntil = 0;
  private failures = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private readonly listeners = new Set<() => void>();
  constructor(settings: ChachaSettings, private readonly transport: ChachaTransport) {
    this.settings = normalizeChachaSettings(settings); this.trigger = new ChachaTrigger(this.settings.frequency);
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit(patch: Partial<ChachaSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch }; this.listeners.forEach((listener) => listener());
  }
  private clearTimer() { if (this.timer !== undefined) clearTimeout(this.timer); this.timer = undefined; }
  private invalidate() {
    this.generation++; this.abort?.abort(); this.abort = undefined;
    this.context = undefined; this.contextSource = undefined; this.deadline = Infinity; this.clearTimer();
    this.emit({ phase: "idle", comment: undefined });
  }
  attach(binding: Binding) {
    this.invalidate(); this.trigger.resetEdits(); this.binding = binding;
    return () => { if (this.binding === binding) { this.invalidate(); this.trigger.resetEdits(); this.binding = undefined; } };
  }
  enable() {
    if (this.disposed) return;
    this.invalidate(); this.trigger.resetEdits(); this.failures = 0;
    const waiting = Date.now() < this.retryUntil;
    this.emit({ enabled: true, paused: waiting, reason: waiting ? "rate" : null });
  }
  disable() { this.invalidate(); this.trigger.resetEdits(); this.emit({ enabled: false, paused: false, reason: null }); }
  connectionChanged() { this.revision++; this.disable(); this.emit({ reason: "connection" }); }
  pause(reason: ChachaSnapshot["reason"] = "manual") { this.invalidate(); this.trigger.resetEdits(); this.emit({ paused: true, reason }); }
  resume(): boolean {
    if (this.disposed || !this.snapshot.enabled || Date.now() < this.retryUntil) return false;
    this.invalidate(); this.trigger.resetEdits(); this.failures = 0; this.emit({ paused: false, reason: null }); return true;
  }
  configure(settings: ChachaSettings) {
    const next = normalizeChachaSettings(settings);
    if (next.prompt === this.settings.prompt && next.frequency === this.settings.frequency) return;
    this.revision++; this.settings = next; this.trigger.frequency = next.frequency;
    this.invalidate(); this.trigger.resetEdits();
  }
  edited(edit: ChachaEdit) {
    if (this.disposed || !this.snapshot.enabled || this.snapshot.paused) return;
    this.lastEdit = Date.now(); this.trigger.edit(edit.amount, edit.position, this.lastEdit); this.pulse();
  }
  resetEdits() { this.trigger.resetEdits(); }
  changed(changes: ChangeDesc) {
    this.lastEdit = Date.now();
    if (this.trigger.position !== undefined) this.trigger.position = changes.mapPos(this.trigger.position, 1);
    if (!this.context) return;
    const source = this.binding!.source();
    const mapped = mapChachaContext(this.context, changes, source);
    if (!mapped) { this.invalidate(); return; }
    if (this.contextSource !== undefined && mayChangeStructure(this.contextSource, source, changes)
      && extractChachaContext(source, mapped.anchor.from)?.key !== mapped.key) { this.invalidate(); return; }
    this.contextSource = source;
    this.context = mapped;
    if (this.snapshot.comment) this.emit({ comment: { ...this.snapshot.comment, context: mapped } });
  }
  expand() { if (this.snapshot.phase !== "collapsed") return false; this.deadline = Infinity; this.clearTimer(); this.emit({ phase: "expanded" }); return true; }
  dismiss() { this.invalidate(); this.trigger.resetEdits(); }
  dispose() { this.disposed = true; this.invalidate(); this.binding = undefined; this.listeners.clear(); }
  private arm(delay: number) { this.timer = setTimeout(() => { this.timer = undefined; this.pulse(); }, Math.max(1, delay)); }
  private fail(reason: unknown) {
    const error = reason && typeof reason === "object" ? reason as { kind?: unknown; retry_after?: unknown } : {};
    if (error.kind === "connection") { this.connectionChanged(); return; }
    if (error.kind === "timeout") this.transportGeneration = undefined;
    this.invalidate(); this.failures++;
    if (error.kind === "auth") this.pause("auth");
    else if (error.kind === "rate") {
      const header = typeof error.retry_after === "string" ? error.retry_after : "";
      const seconds = /^\d+(?:\.\d+)?$/.test(header) ? Number(header) : NaN;
      const until = Number.isFinite(seconds) ? Date.now() + seconds * 1000 : Date.parse(header);
      this.retryUntil = Number.isFinite(until) ? Math.max(Date.now(), until) : Date.now() + 60000;
      this.pause("rate");
    } else if (this.failures >= 3) this.pause("failures");
  }
  pulse() {
    this.clearTimer();
    const binding = this.binding, now = Date.now();
    if (this.disposed || !binding || !this.snapshot.enabled || this.snapshot.paused) return;
    const phase = this.snapshot.phase;
    if (phase === "requesting") {
      if (now >= this.deadline) this.fail({ kind: "timeout" }); else this.arm(this.deadline - now);
      return;
    }
    if (phase !== "idle") {
      if (!this.context || !binding.visible(this.context.anchor.from) || now >= this.deadline) { this.dismiss(); return; }
      if (phase === "pending") {
        if (extractChachaContext(binding.source(), this.context.anchor.from)?.key !== this.context.key) { this.dismiss(); return; }
        const idle = this.lastEdit + CHACHA_FREQUENCIES[this.settings.frequency].idle - now;
        if (!binding.blocked() && idle <= 0) { this.deadline = now + 180000; this.emit({ phase: "collapsed" }); this.arm(180000); }
        else this.arm(Math.min(this.deadline - now, !binding.blocked() && idle > 0 ? idle : Infinity));
      } else if (phase === "collapsed") this.arm(this.deadline - now);
      return;
    }
    if (this.transportGeneration !== undefined) return;
    const delay = this.trigger.delay(now);
    if (delay === null || binding.blocked()) return;
    if (delay > 0) { this.arm(delay); return; }
    const source = binding.source(), context = extractChachaContext(source, this.trigger.position!);
    const file = JSON.stringify([binding.file, this.revision]);
    if (!context || binding.targetEdited?.(context) === false || this.trigger.seen(file, context.key)) { this.trigger.resetEdits(); return; }
    this.context = context; this.contextSource = source; this.trigger.sent(file, context.key, now);
    const generation = ++this.generation, abort = new AbortController(); this.abort = abort;
    this.transportGeneration = generation;
    this.deadline = now + 60000; this.emit({ phase: "requesting", comment: undefined }); this.arm(60000);
    const messages = buildChachaMessages(this.settings.prompt, context.text);
    void Promise.resolve().then(() => {
      if (generation !== this.generation || abort.signal.aborted) throw { kind: "cancelled" };
      return this.transport({ requestId: requestId(), messages, signal: abort.signal });
    }).then((raw) => {
      if (generation !== this.generation || this.disposed) return;
      this.abort = undefined;
      if (!this.context || extractChachaContext(binding.source(), this.context.anchor.from)?.key !== this.context.key) { this.dismiss(); return; }
      const comment = parseChachaResponse(raw);
      this.failures = 0;
      if (!comment) { this.dismiss(); return; }
      this.deadline = Date.now() + 30000; this.emit({ phase: "pending", comment: { ...comment, context: this.context } }); this.pulse();
    }).catch((error: unknown) => { if (generation === this.generation && !this.disposed) this.fail(error); }).finally(() => {
      if (this.transportGeneration === generation) { this.transportGeneration = undefined; this.pulse(); }
    });
  }
}
