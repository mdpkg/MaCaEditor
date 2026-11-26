import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { ChachaRuntime } from "../hooks/useChachaRuntime";
import { CHACHA_TIMING, type ChachaSettings } from "../lib/chachaSettings";
import { loadChachaConnection, type ChachaConnection } from "../lib/chachaTransport";
import type { ChachaSnapshot } from "../lib/chachaSession";
import { Dialog } from "./Dialog";

const disabled: ChachaSnapshot = { enabled: false, paused: false, reason: null, phase: "idle" };
const noSubscribe = () => () => {};
const reasons = {
  auth: "認証エラーのため一時停止中です。AI 設定を確認してから再開してください。",
  rate: "レート制限のため一時停止中です。接続先が指定した待機期間後に再開できます。",
  failures: "連続した通信失敗のため一時停止中です。接続先を確認してから再開してください。",
  manual: "一時停止中です。再開後の編集から反応します。",
  connection: "AI 接続設定が変わりました。この文書で改めて有効化してください。",
};

export function ChachaControls({ runtime, compact = false, onOpenAiSettings }: {
  runtime?: ChachaRuntime; settings: ChachaSettings; compact?: boolean; onOpenAiSettings?: () => void;
}) {
  const state = useSyncExternalStore(runtime?.session.subscribe ?? noSubscribe, () => runtime?.session.snapshot ?? disabled);
  const [confirmation, setConfirmation] = useState<{ runtime: ChachaRuntime; connection: ChachaConnection }>();
  const [preparing, setPreparing] = useState(false), [message, setMessage] = useState("");
  const current = useRef(runtime); current.current = runtime;
  const attempt = useRef(0), alive = useRef(true), cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; attempt.current++; }; }, []);
  useEffect(() => { attempt.current++; setConfirmation(undefined); setPreparing(false); setMessage(""); }, [runtime]);
  const prepare = async () => {
    if (!runtime) return;
    const request = ++attempt.current; setPreparing(true); setMessage("");
    try {
      const connection = await loadChachaConnection();
      if (!connection.endpoint.trim() || !connection.model.trim()) throw new Error("not configured");
      if (alive.current && current.current === runtime && attempt.current === request) setConfirmation({ runtime, connection });
    } catch {
      if (alive.current && current.current === runtime && attempt.current === request) setMessage("AI 設定で接続先とモデルを保存してください。");
    } finally { if (alive.current && current.current === runtime && attempt.current === request) setPreparing(false); }
  };
  const toggle = () => {
    if (!runtime) return;
    setMessage("");
    if (!state.enabled) { void prepare(); return; }
    if (state.paused) { if (!runtime.session.resume()) setMessage("接続先が指定した待機期間中は再開できません。"); }
    else runtime.session.pause();
  };
  const label = `茶々入れ：${state.enabled ? state.paused ? "一時停止" : "有効" : "無効"}`;
  const explanation = state.reason ? reasons[state.reason] : "";
  return <>
    <span className={compact ? "chacha-status" : "chacha-controls"}>
      {!compact && <span>{label}</span>}
      <button type="button" disabled={!runtime || preparing} onClick={toggle}
        title={message || explanation || (state.enabled ? state.paused ? "再開" : "一時停止" : "現在の文書だけで有効化")}
        aria-haspopup={!state.enabled ? "dialog" : undefined}
        aria-label={compact ? state.enabled ? state.paused ? "茶々入れを再開" : "茶々入れを一時停止" : "茶々入れをこの文書で有効化" : undefined}>
        {compact ? label : state.enabled ? state.paused ? "再開" : "一時停止" : "この文書で有効化"}
      </button>
      {!compact && state.enabled && <button type="button" onClick={() => runtime?.session.disable()}>無効化</button>}
      {!compact && explanation && <span className="chacha-reason">{explanation}</span>}
      {!compact && runtime?.connection.current && <span className="chacha-reason">有効化時の接続先：{runtime.connection.current.endpoint} / {runtime.connection.current.model}</span>}
      {message && (compact ? <span title={message}>
        {onOpenAiSettings && !state.enabled ? <button type="button" onClick={onOpenAiSettings}>AI 設定を開く</button> : state.enabled ? "待機期間中" : "設定を確認"}
      </span> : <span className="chacha-reason">{message}{onOpenAiSettings && !state.enabled && <button type="button" onClick={onOpenAiSettings}>AI 設定を開く</button>}</span>)}
    </span>
    {confirmation && confirmation.runtime === runtime && createPortal(<Dialog className="about-dialog ai-settings-dialog chacha-enable-dialog" title="この文書で茶々入れを有効化" initialFocus={cancelRef} onClose={() => setConfirmation(undefined)}>
      <p>執筆中の文章を LLM へ自動送信します。現在の文書パッケージでのみ有効になり、文書を閉じると解除されます。</p>
      <p>接続先：{confirmation.connection.endpoint}<br />モデル：{confirmation.connection.model}</p>
      <p>送信範囲：編集した段落と前後各1段落、直近の見出し（合計最大2,000文字）。他のファイルやチャット履歴は送りません。</p>
      <p>本文の追加・変更・削除後、{CHACHA_TIMING.idle / 1000}秒の入力停止で評価します。最低編集文字数はありません。要求開始の間隔は最短{CHACHA_TIMING.interval / 1000}秒です。初回も編集を待ち、反応がない場合もあります。</p>
      <p>接続先によっては API 利用料金が発生します。コメントを一切操作しなくても執筆を続けられます。</p>
      <div className="about-dialog-actions">
        <button ref={cancelRef} type="button" onClick={() => setConfirmation(undefined)}>キャンセル</button>
        <button type="button" onClick={() => {
          if (current.current !== confirmation.runtime) return;
          confirmation.runtime.connection.current = confirmation.connection; confirmation.runtime.session.enable(); setConfirmation(undefined);
        }}>自動送信を有効にする</button>
      </div>
    </Dialog>, document.body)}
  </>;
}
