export interface SlideSourceMap {
  slideIndex: number;
  startOffset: number;
  endOffset: number;
}

export function slideAtOffset(slides: SlideSourceMap[], offset: number): number {
  for (let index = slides.length - 1; index >= 0; index--) {
    if (offset >= slides[index].startOffset) return index;
  }
  return 0;
}

/** Preserve the source anchor across an insertion/deletion, then clamp on removal. */
export function mapSourceOffset(before: string, after: string, offset: number): number {
  const anchor = Math.min(before.length, Math.max(0, offset));
  const tail = before.slice(anchor);
  if (tail) {
    const match = after.indexOf(tail);
    if (match >= 0 && after.indexOf(tail, match + 1) < 0) return match;
  }
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let oldEnd = before.length;
  let newEnd = after.length;
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd--; newEnd--; }
  if (anchor < start) return anchor;
  return Math.min(after.length, anchor >= oldEnd ? anchor + newEnd - oldEnd : newEnd);
}
