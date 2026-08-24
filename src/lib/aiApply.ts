import type { AiSelectionSnapshot } from "./aiSelection";

/// Replace Selection / Insert Below の適用結果。
/// 通常の CodeMirror transaction 相当の変更として扱う。
export interface AiApplyResult {
  content: string;
  from: number;
  to: number;
}

/// Apply 前に selection が stale になっていないかを検証する。
/// 現在の from..to の文字列が AI 開始時の selected text と一致しない場合は拒否する。
export function isSelectionStale(
  currentContent: string,
  from: number,
  to: number,
  expectedText: string,
): boolean {
  if (from < 0 || to > currentContent.length || from > to) return true;
  return currentContent.slice(from, to) !== expectedText;
}

/// Replace Selection: AI 結果で元 selection を置換する。
export function replaceSelection(
  content: string,
  from: number,
  to: number,
  result: string,
): AiApplyResult {
  return {
    content: content.slice(0, from) + result + content.slice(to),
    from,
    to: from + result.length,
  };
}

/// Insert Below: AI 結果を元 selection の直後へ挿入する。
/// 元 selection の直後が本文なら、結果と文字列が連結されないよう改行を調整する。
export function insertBelow(
  content: string,
  from: number,
  to: number,
  result: string,
): AiApplyResult {
  const before = content.slice(0, to);
  const after = content.slice(to);
  // 元 selection の直後が本文なら、結果と文字列が連結されないよう空白で区切る。
  // 無条件に大量の空行は追加しない。
  const prefix = before.length > 0 && !before.endsWith("\n") ? " " : "";
  const suffix = after.length > 0 && !after.startsWith("\n") && !after.startsWith(" ") ? " " : "";
  const insertion = `${prefix}${result}${suffix}`;
  return {
    content: before + insertion + after,
    from: to,
    to: to + insertion.length,
  };
}

/// Discard: 本文を一切変更しない。
export function discardSelection(content: string): string {
  return content;
}

/// 適用可否を判定する。
/// stale の場合は拒否し、ユーザーへ文書変更を通知する。
export function applyAiResult(
  currentContent: string,
  snapshot: AiSelectionSnapshot,
  result: string,
  mode: "replace" | "insert",
): { ok: true; result: AiApplyResult } | { ok: false; reason: "stale" } {
  if (isSelectionStale(currentContent, snapshot.from, snapshot.to, snapshot.text)) {
    return { ok: false, reason: "stale" };
  }
  const applied = mode === "replace"
    ? replaceSelection(currentContent, snapshot.from, snapshot.to, result)
    : insertBelow(currentContent, snapshot.from, snapshot.to, result);
  return { ok: true, result: applied };
}
