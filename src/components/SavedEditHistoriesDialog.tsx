import { useEffect, useRef, useState } from "react";
import { deleteSavedEditHistory, listSavedEditHistories } from "../lib/tauri";
import { uiText } from "../lib/uiText";
import type { SavedEditHistory } from "../types";
import { Dialog } from "./Dialog";
import { ErrorDetails } from "./ErrorDetails";

const columns = [
  ["path", "Saved location"],
  ["saved_at", "Last saved"],
  ["access", "Access status"],
] as const;
type SortKey = typeof columns[number][0];
type Sort = { key: SortKey; direction: "ascending" | "descending" };

const accessLabels: Record<SavedEditHistory["access"], string> = {
  available: "Accessible",
  missing: "Not found",
  unavailable: "Unavailable",
  denied: "Access denied",
  wrong_kind: "Unexpected document type",
};
const localTime = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "medium" });
const filterKey = (value: string) => value.normalize("NFKC").replace(/\\/g, "/").toLowerCase();

function compareRows(left: SavedEditHistory, right: SavedEditHistory, sort: Sort): number {
  let difference: number;
  if (sort.key === "saved_at") {
    if (left.saved_at === null || right.saved_at === null) {
      return Number(left.saved_at === null) - Number(right.saved_at === null) || left.path.localeCompare(right.path);
    }
    difference = left.saved_at - right.saved_at;
  } else if (sort.key === "access") {
    difference = uiText(accessLabels[left.access]).localeCompare(uiText(accessLabels[right.access]));
  } else {
    difference = left.path.localeCompare(right.path, undefined, { sensitivity: "base", numeric: true });
  }
  return difference * (sort.direction === "ascending" ? 1 : -1) || left.path.localeCompare(right.path);
}

export function SavedEditHistoriesDialog({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<SavedEditHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [request, setRequest] = useState(0);
  const [loadError, setLoadError] = useState<string>();
  const [deleteError, setDeleteError] = useState<string>();
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<Sort>({ key: "saved_at", direction: "descending" });
  const [selected, setSelected] = useState<SavedEditHistory>();
  const [deleting, setDeleting] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
    void listSavedEditHistories().then(
      (rows) => { if (active) setEntries(rows); },
      (error) => { if (active) setLoadError(String(error)); },
    ).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [request]);

  const reload = () => {
    setLoadError(undefined);
    setLoading(true);
    setRequest((value) => value + 1);
  };
  const dismissConfirmation = () => {
    if (deleting) return;
    setSelected(undefined);
    setDeleteError(undefined);
  };
  const confirmDelete = async () => {
    if (!selected || deleting) return;
    setDeleting(true);
    setDeleteError(undefined);
    try {
      await deleteSavedEditHistory(selected.id);
      setSelected(undefined);
      setEntries((rows) => rows.filter((row) => row.id !== selected.id));
      setNotice(uiText("Saved edit history cleared. Disk space is reclaimed in the background."));
      reload();
    } catch (error) {
      setDeleteError(String(error));
    } finally {
      setDeleting(false);
    }
  };
  const query = filterKey(filter.trim());
  const rows = entries.filter(({ path }) => filterKey(path).includes(query)).sort((left, right) => compareRows(left, right, sort));

  return (
    <Dialog title={uiText("Saved edit histories")} className="about-dialog saved-history-dialog" onClose={onClose} initialFocus={search}>
      <label>
        {uiText("Filter by path or file name")}
        <input ref={search} type="search" value={filter} onChange={(event) => setFilter(event.target.value)} />
      </label>
      <p>{uiText("Unavailable locations remain in the list until you clear their history.")}</p>
      {notice && <p role="status">{notice}</p>}
      {loadError && <div role="alert">{uiText("Could not list saved edit histories.")}<ErrorDetails detail={loadError} /></div>}
      {loading && <p role="status">{uiText("Loading…")}</p>}
      {!loading && !loadError && rows.length === 0 && <p>{uiText(query ? "No matching saved edit histories." : "No saved edit histories.")}</p>}
      {rows.length > 0 && (
        <div className="saved-history-table-scroll">
          <table className="saved-history-table">
            <thead><tr>
              {columns.map(([key, label]) => (
                <th key={key} scope="col" aria-sort={sort.key === key ? sort.direction : undefined}>
                  <button type="button" onClick={() => setSort({
                    key, direction: sort.key === key && sort.direction === "ascending" ? "descending" : "ascending",
                  })}>{uiText(label)}</button>
                </th>
              ))}
              <th scope="col" aria-label={uiText("Clear")} />
            </tr></thead>
            <tbody>{rows.map((row) => (
              <tr key={row.id}>
                <td>{row.path}</td>
                <td>{row.saved_at === null ? uiText("Unknown") : (
                  <time dateTime={new Date(row.saved_at).toISOString()}>{localTime.format(row.saved_at)}</time>
                )}</td>
                <td>{uiText(accessLabels[row.access])}</td>
                <td><button type="button" aria-label={uiText("Clear…") + " " + row.path}
                  onClick={() => { setNotice(""); setSelected(row); }}>{uiText("Clear…")}</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <div className="about-dialog-actions">
        <button type="button" disabled={loading} onClick={reload}>{uiText("Refresh")}</button>
        <button type="button" onClick={onClose}>{uiText("Close")}</button>
      </div>
      {selected && (
        <Dialog title={uiText("Clear saved edit history?")} onClose={dismissConfirmation} initialFocus={cancel}>
          <p className="saved-history-confirm-path">{selected.path}</p>
          <p>{uiText("This clears the saved history for this location. Saving an open document stores its current history again.")}</p>
          {deleteError && <div role="alert">{uiText("Could not clear saved edit history.")}<ErrorDetails detail={deleteError} /></div>}
          <div className="about-dialog-actions">
            <button ref={cancel} type="button" disabled={deleting} onClick={dismissConfirmation}>{uiText("Cancel")}</button>
            <button type="button" disabled={deleting} onClick={() => void confirmDelete()}>
              {uiText(deleting ? "Clearing edit history…" : "Clear")}
            </button>
          </div>
        </Dialog>
      )}
    </Dialog>
  );
}
