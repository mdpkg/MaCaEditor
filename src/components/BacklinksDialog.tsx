import { uiText } from "../lib/uiText";
import { Dialog } from "./Dialog";
import type { Backlink } from "../lib/packageNavigation";

interface Props {
  target: string;
  backlinks: Backlink[];
  onNavigate: (path: string, offset: number) => void;
  onClose: () => void;
}

export function BacklinksDialog({ target, backlinks, onNavigate, onClose }: Props) {
  return <Dialog onClose={onClose} title={<>{uiText("References to")}{target}</>}>
    {backlinks.length === 0 ? <p>{uiText("No references found.")}</p> : <ul className="backlinks-list">
      {backlinks.map((item) => <li key={`${item.path}:${item.offset}`}>
        <button type="button" onClick={() => onNavigate(item.path, item.offset)}>{item.path}:{item.line}</button>
      </li>)}
    </ul>}
    <div className="about-dialog-actions"><button type="button" onClick={onClose}>{uiText("Close")}</button></div>
  </Dialog>;
}
