import type { ChangeSet, Text } from "@codemirror/state";

export interface ChachaEdit { amount: number; position: number }

/** Composition is counted once from its original document to its committed value. */
export class ChachaEdits {
  private composition: Text | undefined;
  reset() { this.composition = undefined; }
  change(changes: ChangeSet, before: Text, after: Text, composing: boolean): ChachaEdit | null {
    if (composing) { this.composition ??= before; return null; }
    if (this.composition) return this.finish(after);
    let amount = 0, position = 0;
    changes.iterChanges((fromA, toA, _fromB, toB, inserted) => {
      amount += Array.from(before.sliceString(fromA, toA)).length + Array.from(inserted.toString()).length;
      position = toB;
    });
    return amount ? { amount, position } : null;
  }
  finish(after: Text): ChachaEdit | null {
    if (!this.composition) return null;
    const previous = Array.from(this.composition.toString()), next = Array.from(after.toString());
    this.reset();
    let start = 0, oldEnd = previous.length, newEnd = next.length;
    while (start < oldEnd && start < newEnd && previous[start] === next[start]) start++;
    while (oldEnd > start && newEnd > start && previous[oldEnd - 1] === next[newEnd - 1]) { oldEnd--; newEnd--; }
    const amount = oldEnd - start + newEnd - start;
    return amount ? { amount, position: next.slice(0, newEnd).join("").length } : null;
  }
}
