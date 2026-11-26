import { useEffect, useId, useState, type ReactNode } from "react";
import { loadChachaPreferences, saveChachaPreferences } from "../lib/chachaPreferences";
import { DEFAULT_CHACHA_PROMPT, CHACHA_TIMING, normalizeChachaSettings, type ChachaSettings as Settings } from "../lib/chachaSettings";

export function ChachaSettings({ onSaved, children }: { onSaved?: (settings: Settings) => void; children?: ReactNode }) {
  const id = useId();
  const [settings, setSettings] = useState(normalizeChachaSettings);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  useEffect(() => {
    let alive = true;
    void loadChachaPreferences().then((value) => { if (alive) { setSettings(value); setLoaded(true); } });
    return () => { alive = false; };
  }, []);
  const save = async () => {
    setBusy(true);
    try {
      const value = normalizeChachaSettings(settings);
      await saveChachaPreferences(value);
      setSettings(value);
      onSaved?.(value);
      setStatus("茶々入れ設定を保存しました。");
    } catch {
      setStatus("保存できませんでした。人格は10,000文字以内にし、保存先を確認してください。");
    } finally { setBusy(false); }
  };
  return <fieldset className="chacha-settings" disabled={!loaded || busy}>
    <legend>茶々入れ</legend>
    {children}
    <p>対象段落と前後各1段落・直近の見出し（合計最大2,000文字）を既存の AI 接続先へ送信します。API 利用料金が発生する場合があります。</p>
    <p>本文変更後に{CHACHA_TIMING.idle / 1000}秒停止すると評価し、要求開始の間隔は最短{CHACHA_TIMING.interval / 1000}秒です。旧頻度設定は使用しません。</p>
    <label htmlFor={`${id}-prompt`}>読者の人格・口調（最大10,000文字、空欄は初期値）</label>
    <textarea id={`${id}-prompt`} rows={8} value={settings.prompt} onChange={(event) => {
      setSettings((previous) => ({ ...previous, prompt: event.target.value })); setStatus("");
    }} />
    <p>{Array.from(settings.prompt).length.toLocaleString()} / 10,000文字</p>
    <div className="about-dialog-actions">
      <button type="button" onClick={() => { setSettings((value) => ({ ...value, prompt: DEFAULT_CHACHA_PROMPT })); setStatus(""); }}>初期プロンプトに戻す</button>
      <button type="button" disabled={Array.from(settings.prompt).length > 10000} onClick={() => { void save(); }}>茶々入れ設定を保存</button>
    </div>
    {status && <p role="status">{status}</p>}
  </fieldset>;
}
