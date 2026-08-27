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
  return <div className="about-dialog-backdrop" onPointerDown={onClose}>
    <section className="about-dialog package-search-dialog" role="dialog" aria-modal="true"
      aria-label="Package search" onPointerDown={(event) => event.stopPropagation()}>
      <h2>Search Package</h2>
      <div className="package-search-controls">
        <input type="search" autoFocus value={query} placeholder="Search"
          onChange={(event) => setQuery(event.target.value)} />
        <select aria-label="Search type" value={kind}
          onChange={(event) => setKind(event.target.value as PackageSearchKind)}>
          <option value="all">All</option><option value="filename">File name</option>
          <option value="content">Full text</option><option value="heading">Heading</option>
          <option value="link">Link destination</option><option value="backlink">References to exact path</option>
        </select>
      </div>
      <p>{results.length} results</p>
      <ul className="package-search-results">{results.map((result, index) => <li
        key={`${result.kind}-${result.path}-${result.offset}-${index}`}>
        <button type="button" onClick={() => onNavigate(result.path, result.offset)}>
          <strong>{result.path}:{result.line}</strong><span>{result.kind} — {result.preview}</span>
        </button>
      </li>)}</ul>
      <div className="about-dialog-actions"><button type="button" onClick={onClose}>Close</button></div>
    </section>
  </div>;
}
