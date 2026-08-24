import type { AiConfig, AiStreamEvent } from "../types";
import { cancelAiRequest, loadAiConfig, startAiSelectionAction } from "./tauri";

/// AI タスクの種類。Rust 側 `AiTaskKind` と対応する。
export type AiTaskKind = "Rewrite" | "Summarize" | "Proofread";

/// AI Action 実行時点の selection を明示的に保持するスナップショット。
export interface AiSelectionSnapshot {
  from: number;
  to: number;
  text: string;
}

/// ストリーミングの状態。
export type AiStreamState =
  | "idle"
  | "running"
  | "completed"
  | "cancelled"
  | "error";

/// 選択テキストが AI Action の対象として有効か判定する。
/// 空・空白のみ・改行のみの selection は無効とする。
export function isSelectionValid(snapshot: AiSelectionSnapshot | null): boolean {
  if (!snapshot) return false;
  if (snapshot.from >= snapshot.to) return false;
  return snapshot.text.trim().length > 0;
}

/// 選択範囲全体が fenced code block に含まれるかを判定する。
/// 安全のため、selection 全体が code fence 内なら AI Action を無効化する。
export function isEntirelyInsideCodeBlock(
  content: string,
  from: number,
  to: number,
): boolean {
  const before = content.slice(0, from);
  const fences = before.match(/```/g)?.length ?? 0;
  // from より前の fence 数が奇数なら、selection は code block 内にある。
  // さらに to 以降に閉じ fence が現れるまで selection 全体が code block 内。
  if (fences % 2 === 0) return false;
  const after = content.slice(to);
  const closingFences = after.match(/```/g)?.length ?? 0;
  return closingFences > 0;
}

/// AI 設定が未設定かどうかを判定する。
export function isAiConfigured(config: AiConfig): boolean {
  return config.base_url.trim().length > 0 && config.model.trim().length > 0;
}

/// エラー種別をユーザー向けのメッセージへ変換する。
/// raw Rust error や内部型名をそのまま表示しない。
export function aiErrorMessage(kind: AiStreamEvent["error"]["kind"]): string {
  switch (kind) {
    case "InvalidConfiguration":
      return "AI configuration is invalid.";
    case "ConnectionFailed":
      return "Could not connect to the AI server.";
    case "AuthenticationFailed":
      return "AI authentication failed. Check your API key.";
    case "PermissionDenied":
      return "AI permission denied.";
    case "ModelNotFound":
      return "The AI model was not found.";
    case "RateLimited":
      return "AI request was rate limited. Try again later.";
    case "Timeout":
      return "The AI request timed out.";
    case "ServerError":
      return "The AI server returned an error.";
    case "InvalidResponse":
      return "The AI returned an invalid response.";
    case "Cancelled":
      return "The AI request was cancelled.";
    case "Unknown":
      return "An unknown AI error occurred.";
  }
}

/// 選択テキストを対象とした AI タスクを実行する。
/// 既存の `ai_selection_action` Tauri command / Streaming 基盤を利用する。
export async function runAiSelectionAction(
  config: AiConfig,
  task: AiTaskKind,
  snapshot: AiSelectionSnapshot,
  onEvent: (event: AiStreamEvent) => void,
): Promise<string> {
  return startAiSelectionAction(
    {
      baseUrl: config.base_url,
      apiKey: config.api_key,
      model: config.model,
      task,
      selectedText: snapshot.text,
      connectTimeoutSeconds: config.connect_timeout_seconds ?? null,
      requestTimeoutSeconds: config.request_timeout_seconds ?? null,
    },
    onEvent,
  );
}

export { loadAiConfig, cancelAiRequest };
