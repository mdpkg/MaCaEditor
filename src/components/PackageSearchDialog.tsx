import { uiText } from "../lib/uiText";
import { ResultsPanel } from "./ResultsPanel";
import { useEffect, useRef, useState } from "react";
import type { FileInfo } from "../types";
import { searchPackage, type PackageSearchKind, type PackageSearchResult } from "../lib/packageSearch";

interface Props {
  files: FileInfo[];
  onNavigate: (path: string, offset: number, length?: number) => void;
  onClose: () => void;
}

export function PackageSearchDialog({ files, onNavigate, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const [kind, setKind] = useState<PackageSearchKind>("all");
  const [completed, setCompleted] = useState<{ files: FileInfo[]; query: string; kind: PackageSearchKind; results: PackageSearchResult[] }>();
  useEffect(() => {
    if (!query.trim()) return;
    const timer = window.setTimeout(() => {
      setCompleted({ files, query, kind, results: searchPackage(files, query, kind) });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [files, query, kind]);
  const pending = Boolean(query.trim()) && (completed?.files !== files || completed?.query !== query || completed?.kind !== kind);
  const results = pending || !query.trim() ? [] : completed?.results ?? [];
  const current = Math.min(active, Math.max(0, results.length - 1));
  const navigate = (index: number) => {
    const result = results[index];
    if (!result) return;
    setActive(index); onNavigate(result.path, result.offset, result.length);
  };
  const move = (direction: number, open = false) => {
    if (!results.length) return;
    const index = (current + direction + results.length) % results.length;
    setActive(index);
    if (open) navigate(index);
    else list.current?.querySelectorAll<HTMLButtonElement>("button")[index]?.focus();
  };
  return <ResultsPanel className="package-search-dialog" onClose={onClose} title={uiText("Search Package")}>
    <div className="package-search-controls">
      <input type="search" aria-label="検索語" value={query} placeholder={uiText("Search")}
        onChange={(event) => { setQuery(event.target.value); setActive(0); }}
        onKeyDown={(event) => {
          if (!results.length) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault(); const index = event.key === "ArrowDown" ? 0 : results.length - 1;
            setActive(index); list.current?.querySelectorAll<HTMLButtonElement>("button")[index]?.focus();
          } else if (event.key === "Enter") { event.preventDefault(); navigate(current); }
        }} />
      <select aria-label={uiText("Search type")} value={kind}
        onChange={(event) => { setKind(event.target.value as PackageSearchKind); setActive(0); }}>
        <option value="all">{uiText("All")}</option><option value="filename">{uiText("File name")}</option>
        <option value="content">{uiText("Full text")}</option><option value="heading">{uiText("Heading")}</option>
        <option value="link">{uiText("Link destination")}</option><option value="backlink">{uiText("References to exact path")}</option>
      </select>
    </div>
    <p role="status">{pending ? "検索中…" : `${results.length} 件${results.length ? `（${current + 1} 件目）` : ""}`}</p>
    <div className="results-navigation">
      <button disabled={!results.length} onClick={() => move(-1, true)}>前の結果</button>
      <button disabled={!results.length} onClick={() => move(1, true)}>次の結果</button>
      <button onClick={onClose}>{uiText("Close")}</button>
    </div>
    <ul ref={list} className="package-search-results" aria-label="検索結果" aria-busy={pending}
      onKeyDown={(event) => {
        if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); move(event.key === "ArrowDown" ? 1 : -1); }
        if (["Home", "End"].includes(event.key)) {
          event.preventDefault(); const index = event.key === "Home" ? 0 : results.length - 1;
          setActive(index); list.current?.querySelectorAll<HTMLButtonElement>("button")[index]?.focus();
        }
      }}>{results.map((result, index) => <li
      key={`${result.kind}-${result.path}-${result.offset}-${index}`}>
      <button type="button" tabIndex={index === current ? 0 : -1} aria-current={index === current ? "true" : undefined}
        onFocus={() => setActive(index)} onClick={() => navigate(index)}>
        <strong>{result.path}:{result.line}</strong><small>{({ filename: "ファイル名", content: "本文", heading: "見出し", link: "リンク", backlink: "参照元" })[result.kind]}</small>
        <span className="search-snippet"><Snippet text={result.preview} query={query} /></span>
      </button>
    </li>)}</ul>
  </ResultsPanel>;
}

function Snippet({ text, query }: { text: string; query: string }) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return <>{text}</>;
  const parts = [];
  const folded = text.toLocaleLowerCase();
  let offset = 0;
  for (let index = folded.indexOf(needle); index >= 0; index = folded.indexOf(needle, offset)) {
    parts.push(text.slice(offset, index), <mark key={index}>{text.slice(index, index + needle.length)}</mark>);
    offset = index + needle.length;
  }
  return <>{parts}{text.slice(offset)}</>;
}
