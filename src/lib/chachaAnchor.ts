import type { ChangeDesc } from "@codemirror/state";
import { extractChachaContext, type ChachaContext } from "./chachaContext";

export function mapChachaContext(context: ChachaContext, changes: ChangeDesc, source?: string): ChachaContext | null {
  let touched = false, boundary = false;
  changes.iterChangedRanges((from, to) => {
    for (const range of context.ranges) {
      if (from === to) {
        if (range.from < from && from < range.to) touched = true;
        if (from === range.from || from === range.to) boundary = true;
      } else if (from < range.to && to > range.from) touched = true;
    }
  });
  if (touched) return null;
  const map = (range: ChachaContext["anchor"]) => ({ from: changes.mapPos(range.from, 1), to: changes.mapPos(range.to, -1) });
  const mapped = { ...context, anchor: map(context.anchor), ranges: context.ranges.map(map) };
  if (boundary && (source === undefined || extractChachaContext(source, mapped.anchor.from)?.key !== context.key)) return null;
  return mapped;
}
