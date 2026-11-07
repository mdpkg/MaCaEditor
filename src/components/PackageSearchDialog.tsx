import { uiText } from "../lib/uiText";
import { Dialog } from "./Dialog";
import { useMemo, useState } from "react";
import type { FileInfo } from "../types";
import { searchPackage, type PackageSearchKind } from "../lib/packageSearch";

interface Props {
  files: FileInfo[];
  onNavigate: (path: string, offset: number) => void;
  onClose: () => void;
}

export function PackageSearchDialog({ files, onNavigate, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<PackageSearchKind>("all");
  const results = useMemo(() => searchPackage(files, query, kind), [files, query, kind]);
  return <Dialog className="about-dialog package-search-dialog" onClose={onClose} title={uiText("Search Package")}>
    <div className="package-search-controls">
      <input type="search" value={query} placeholder={uiText("Search")}
        onChange={(event) => setQuery(event.target.value)} />
      <select aria-label={uiText("Search type")} value={kind}
        onChange={(event) => setKind(event.target.value as PackageSearchKind)}>
        <option value="all">{uiText("All")}</option><option value="filename">{uiText("File name")}</option>
        <option value="content">{uiText("Full text")}</option><option value="heading">{uiText("Heading")}</option>
        <option value="link">{uiText("Link destination")}</option><option value="backlink">{uiText("References to exact path")}</option>
      </select>
    </div>
    <p>{results.length} 件</p>
    <ul className="package-search-results">{results.map((result, index) => <li
      key={`${result.kind}-${result.path}-${result.offset}-${index}`}>
      <button type="button" onClick={() => onNavigate(result.path, result.offset)}>
        <strong>{result.path}:{result.line}</strong><span>{({ filename: "ファイル名", content: "本文", heading: "見出し", link: "リンク", backlink: "参照元" })[result.kind]} — {result.preview}</span>
      </button>
    </li>)}</ul>
    <div className="about-dialog-actions"><button type="button" onClick={onClose}>{uiText("Close")}</button></div>
  </Dialog>;
}
