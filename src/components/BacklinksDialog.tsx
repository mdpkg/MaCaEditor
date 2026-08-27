import type { Backlink } from "../lib/packageNavigation";

interface Props {
  target: string;
  backlinks: Backlink[];
  onNavigate: (path: string, offset: number) => void;
  onClose: () => void;
}

export function BacklinksDialog({ target, backlinks, onNavigate, onClose }: Props) {
  return <div className="about-dialog-backdrop" onPointerDown={onClose}>
    <section className="about-dialog" role="dialog" aria-modal="true" aria-label="References"
      onPointerDown={(event) => event.stopPropagation()}>
      <h2>References to {target}</h2>
      {backlinks.length === 0 ? <p>No references found.</p> : <ul className="backlinks-list">
        {backlinks.map((item) => <li key={`${item.path}:${item.offset}`}>
          <button type="button" onClick={() => onNavigate(item.path, item.offset)}>{item.path}:{item.line}</button>
        </li>)}
      </ul>}
      <div className="about-dialog-actions"><button type="button" onClick={onClose}>Close</button></div>
    </section>
  </div>;
}
