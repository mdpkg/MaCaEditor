import type { AiConfig, AiError, AiStreamEvent } from "../types";
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
export type AiErrorKind = AiError["kind"];

const aiErrorMessages: Record<AiErrorKind, string> = {
  InvalidConfiguration: "AI 設定が正しくありません。",
  ConnectionFailed: "AI サーバーへ接続できませんでした。",
  AuthenticationFailed: "AI の認証に失敗しました。API キーを確認してください。",
  PermissionDenied: "AI のアクセス権限がありません。",
  ModelNotFound: "AI モデルが見つかりませんでした。",
  RateLimited: "AI のリクエスト回数制限に達しました。しばらくしてから再試行してください。",
  Timeout: "AI のリクエストがタイムアウトしました。",
  ServerError: "AI サーバーでエラーが発生しました。",
  InvalidResponse: "AI の応答が正しくありません。",
  StreamInterrupted: "AI の応答の受信が途中で中断されました。",
  Cancelled: "AI のリクエストを中止しました。",
  Unknown: "AI の処理で不明なエラーが発生しました。",
};

export function aiErrorMessage(kind: AiErrorKind): string {
  return aiErrorMessages[kind];
}

export function readAiError(reason: unknown): AiError {
  if (reason && typeof reason === "object" && "kind" in reason) {
    const kind = reason.kind;
    if (kind === "Cancelled") return { kind };
    if ("message" in reason && typeof reason.message === "string") {
      return {
        kind: typeof kind === "string" && Object.prototype.hasOwnProperty.call(aiErrorMessages, kind)
          ? kind as Exclude<AiErrorKind, "Cancelled">
          : "Unknown",
        message: reason.message,
      };
    }
  }
  return {
    kind: "Unknown",
    message: reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "",
  };
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
