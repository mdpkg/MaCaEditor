import { useEffect, useMemo, useRef, useState } from "react";
import { deleteMissingSavedEditHistories, deleteSavedEditHistory, estimateReclaimableHistoryBytes, getHistoryReclaimStatus, listSavedEditHistories } from "../lib/tauri";
import { uiText } from "../lib/uiText";
import type { HistoryReclaimStatus, SavedEditHistory } from "../types";
import { Dialog } from "./Dialog";
import { ErrorDetails } from "./ErrorDetails";

const columns = [
  ["path", "Saved location"],
  ["saved_at", "Last saved"],
  ["access", "Access status"],
  ["size_bytes", "History size"],
] as const;
type SortKey = typeof columns[number][0];
type Sort = { key: SortKey; direction: "ascending" | "descending" };
type Confirmation = { kind: "single"; row: SavedEditHistory } | { kind: "batch"; rows: SavedEditHistory[] };

const accessLabels: Record<SavedEditHistory["access"], string> = {
  available: "Accessible",
  missing: "Not found",
  unavailable: "Unavailable",
  denied: "Access denied",
  wrong_kind: "Unexpected document type",
};
const localTime = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "medium" });
const localSize = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const sizeUnits = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
const filterKey = (value: string) => value.normalize("NFKC").replace(/\\/g, "/").toLowerCase();
const filterDelay = 150;
const reclaimRefreshInterval = 200;

const reclaimLabels: Record<HistoryReclaimStatus["phase"], string> = {
  queued: "Waiting to reclaim disk space…",
  paused_for_save: "Space reclamation is deferred while saving takes priority.",
  reclaiming: "Reclaiming disk space…",
  completed: "Disk space reclamation completed.",
  failed: "Disk space reclamation could not finish. It will be retried after the next save.",
};

function formatSize(bytes: number): string {
  let unit = 0;
  while (bytes >= 1024 && unit < sizeUnits.length - 1) {
    bytes /= 1024;
    unit++;
  }
  return `${localSize.format(bytes)} ${sizeUnits[unit]}`;
}

function compareRows(left: SavedEditHistory, right: SavedEditHistory, sort: Sort): number {
  let difference: number;
  if (sort.key === "saved_at") {
    if (left.saved_at === null || right.saved_at === null) {
      return Number(left.saved_at === null) - Number(right.saved_at === null) || left.path.localeCompare(right.path);
    }
    difference = left.saved_at - right.saved_at;
  } else if (sort.key === "access") {
    difference = uiText(accessLabels[left.access]).localeCompare(uiText(accessLabels[right.access]));
  } else if (sort.key === "size_bytes") {
    difference = left.size_bytes - right.size_bytes;
  } else {
    difference = left.path.localeCompare(right.path, undefined, { sensitivity: "base", numeric: true });
  }
  return difference * (sort.direction === "ascending" ? 1 : -1) || left.path.localeCompare(right.path);
}

function ReclaimSummary({ status }: { status: HistoryReclaimStatus }) {
  const estimated = status.estimated_bytes;
  const released = status.phase === "completed" ? status.released_bytes : null;
  const difference = status.phase === "completed" && status.request_count === 1 && estimated !== null && released !== null
    ? released - estimated : null;
  return (
    <div className="saved-history-reclaim">
      <p role="status">{uiText(reclaimLabels[status.phase])}</p>
      <p title={estimated === null ? undefined : `${estimated} B`}>
        {estimated === null ? uiText("The pre-deletion estimate is unavailable.")
          : uiText("Pre-deletion estimate {size}").replace("{size}", formatSize(estimated))}
      </p>
      {status.phase === "completed" && (
        <>
          <p title={released === null ? undefined : `${released} B`}>
            {released === null ? uiText("The measured size is unavailable.")
              : uiText("Disk space actually reclaimed {size}").replace("{size}", formatSize(released))}
          </p>
          {status.request_count !== null && status.request_count > 1 && (
            <p>{uiText("The measurement covers multiple reclamation requests.")}</p>
          )}
          {difference !== null && (
            <p>{uiText("Difference from estimate {size}").replace("{size}",
              `${difference > 0 ? "+" : difference < 0 ? "−" : ""}${formatSize(Math.abs(difference))}`)}</p>
          )}
        </>
      )}
    </div>
  );
}

export function SavedEditHistoriesDialog({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<SavedEditHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [request, setRequest] = useState(0);
  const [loadError, setLoadError] = useState<string>();
  const [deleteError, setDeleteError] = useState<string>();
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("");
  const [query, setQuery] = useState("");
  const [composing, setComposing] = useState(false);
  const [missingOnly, setMissingOnly] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [sort, setSort] = useState<Sort>({ key: "saved_at", direction: "descending" });
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [estimate, setEstimate] = useState<number | null>();
  const [deleting, setDeleting] = useState(false);
  const [reclaim, setReclaim] = useState<HistoryReclaimStatus | null>(null);
  const [reclaimRefresh, setReclaimRefresh] = useState(0);
  const search = useRef<HTMLInputElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const draftQuery = filterKey(filter.trim());
  const filtering = composing || draftQuery !== query;

  useEffect(() => {
    let active = true;
    void listSavedEditHistories().then(
      (rows) => { if (active) setEntries(rows); },
      (error) => { if (active) setLoadError(String(error)); },
    ).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [request]);

  useEffect(() => {
    if (composing || draftQuery === query) return;
    const timer = window.setTimeout(() => {
      setQuery(draftQuery);
      setChecked((ids) => ids.size === 0 ? ids : new Set(
        entries.filter(({ id, path }) => ids.has(id) && filterKey(path).includes(draftQuery)).map(({ id }) => id),
      ));
    }, filterDelay);
    return () => window.clearTimeout(timer);
  }, [composing, draftQuery, entries, query]);

  useEffect(() => {
    if (confirmation?.kind !== "batch") return;
    let active = true;
    void estimateReclaimableHistoryBytes(confirmation.rows.map(({ id }) => id)).then(
      (bytes) => { if (active) setEstimate(bytes); },
      () => { if (active) setEstimate(null); },
    );
    return () => { active = false; };
  }, [confirmation]);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const update = async () => {
      try {
        const status = await getHistoryReclaimStatus();
        if (!active) return;
        setReclaim(status);
        if (!status || status.phase === "completed") return;
      } catch {
        // Keep the last known state while IPC is temporarily unavailable.
      }
      if (active) timer = window.setTimeout(() => void update(), reclaimRefreshInterval);
    };
    void update();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [reclaimRefresh]);

  const reload = () => {
    setLoadError(undefined);
    setLoading(true);
    setChecked(new Set());
    setRequest((value) => value + 1);
  };
  const toggleChecked = (id: string, value: boolean) => {
    setChecked((ids) => {
      const next = new Set(ids);
      if (value) next.add(id);
      else next.delete(id);
      return next;
    });
  };
  const openConfirmation = (target: Confirmation) => {
    setNotice("");
    setEstimate(undefined);
    setConfirmation(target);
  };
  const dismissConfirmation = () => {
    if (deleting) return;
    setConfirmation(undefined);
    setDeleteError(undefined);
  };
  const confirmDelete = async () => {
    if (!confirmation || deleting) return;
    setDeleting(true);
    setDeleteError(undefined);
    try {
      let deleted: string[];
      let skipped = 0;
      if (confirmation.kind === "batch") {
        const ids = confirmation.rows.map(({ id }) => id);
        deleted = await deleteMissingSavedEditHistories(ids, estimate ?? null);
        if (deleted.length > 0) setReclaimRefresh((value) => value + 1);
        skipped = ids.length - deleted.length;
      } else {
        await deleteSavedEditHistory(confirmation.row.id);
        deleted = [confirmation.row.id];
      }
      const removed = new Set(deleted);
      setConfirmation(undefined);
      setEntries((rows) => rows.filter(({ id }) => !removed.has(id)));
      const cleared = deleted.length > 0 ? uiText("Saved edit history cleared. Disk space is reclaimed in the background.") : "";
      const kept = skipped > 0 ? uiText("Kept {count} histories because their absence could not be confirmed or their saved history changed.")
        .replace("{count}", String(skipped)) : "";
      setNotice([cleared, kept].filter(Boolean).join(" "));
      reload();
    } catch (error) {
      setDeleteError(String(error));
    } finally {
      setDeleting(false);
    }
  };
  const rows = useMemo(() => entries
    .filter(({ path, access }) => (!missingOnly || access === "missing") && filterKey(path).includes(query))
    .sort((left, right) => compareRows(left, right, sort)), [entries, missingOnly, query, sort]);
  const selectedRows = useMemo(() => rows.filter(({ id, access }) => access === "missing" && checked.has(id)), [rows, checked]);
  const unavailableActions = loading || !!loadError || filtering;

  return (
    <Dialog title={uiText("Saved edit histories")} className="about-dialog saved-history-dialog" onClose={onClose} initialFocus={search}>
      <label>
        {uiText("Filter by path or file name")}
        <input ref={search} type="search" value={filter} onChange={(event) => setFilter(event.target.value)}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={(event) => { setFilter(event.currentTarget.value); setComposing(false); }} />
      </label>
      <div className="saved-history-batch-controls">
        <label className="saved-history-missing-filter">
          <input type="checkbox" aria-label={uiText("Not found only")} checked={missingOnly}
            onChange={(event) => setMissingOnly(event.target.checked)} />
          {uiText("Not found only")}
        </label>
        <button type="button" disabled={unavailableActions || selectedRows.length === 0}
          onClick={() => openConfirmation({ kind: "batch", rows: selectedRows })}>
          {uiText("Clear selected histories…")}
        </button>
        {selectedRows.length > 0 && <span>{uiText("{count} selected").replace("{count}", String(selectedRows.length))}</span>}
      </div>
      <p>{uiText("Unavailable locations remain in the list until you clear their history.")}</p>
      <p>{uiText("History size includes attachments shared with other documents.")}</p>
      {notice && <p role="status">{notice}</p>}
      {reclaim && <ReclaimSummary status={reclaim} />}
      {loadError && <div role="alert">{uiText("Could not list saved edit histories.")}<ErrorDetails detail={loadError} /></div>}
      <div className="saved-history-table-scroll" aria-busy={loading}>
        <table className="saved-history-table">
          <thead><tr>
            {columns.map(([key, label]) => (
              <th key={key} scope="col" aria-sort={sort.key === key ? sort.direction : undefined}>
                <button type="button" onClick={() => setSort({
                  key, direction: sort.key === key && sort.direction === "ascending" ? "descending" : "ascending",
                })}>{uiText(label)}</button>
              </th>
            ))}
            <th scope="col" aria-label={uiText("Select")} />
            <th scope="col" aria-label={uiText("Clear")} />
          </tr></thead>
          <tbody>
            {rows.length === 0 && !loadError && <tr><td colSpan={columns.length + 2}>
              {uiText(loading ? "Loading…" : query || missingOnly ? "No matching saved edit histories." : "No saved edit histories.")}
            </td></tr>}
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.path}</td>
                <td>{row.saved_at === null ? uiText("Unknown") : (
                  <time dateTime={new Date(row.saved_at).toISOString()}>{localTime.format(row.saved_at)}</time>
                )}</td>
                <td>{uiText(accessLabels[row.access])}</td>
                <td title={`${row.size_bytes} B`}>{formatSize(row.size_bytes)}</td>
                <td>{row.access === "missing" && (
                  <input type="checkbox" aria-label={uiText("Select") + " " + row.path} checked={checked.has(row.id)}
                    disabled={unavailableActions} onChange={(event) => toggleChecked(row.id, event.target.checked)} />
                )}</td>
                <td><button type="button" disabled={unavailableActions} aria-label={uiText("Clear…") + " " + row.path}
                  onClick={() => openConfirmation({ kind: "single", row })}>{uiText("Clear…")}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="about-dialog-actions">
        <button type="button" disabled={loading} onClick={reload}>{uiText("Refresh")}</button>
        <button type="button" onClick={onClose}>{uiText("Close")}</button>
      </div>
      {confirmation && (
        <Dialog title={uiText(confirmation.kind === "batch" ? "Clear selected saved edit histories?" : "Clear saved edit history?")}
          onClose={dismissConfirmation} initialFocus={cancel}>
          {confirmation.kind === "batch" ? (
            <>
              <p>{uiText("The selected histories will be cleared only if their locations are still not found.")}</p>
              <ul className="saved-history-confirm-path saved-history-confirm-list">
                {confirmation.rows.map(({ id, path }) => <li key={id}>{path}</li>)}
              </ul>
              <p role="status" className="saved-history-estimate">
                {estimate === undefined ? uiText("Estimating recoverable space…") : estimate === null
                  ? uiText("Recoverable space could not be estimated.")
                  : uiText("Estimated recoverable space {size}").replace("{size}", formatSize(estimate))}
              </p>
              <p>{uiText("The estimate excludes attachments kept by other documents. Actual recovery depends on SQLite page usage and which histories are cleared.")}</p>
            </>
          ) : (
            <>
              <p className="saved-history-confirm-path">{confirmation.row.path}</p>
              <p>{uiText("This clears the saved history for this location. Saving an open document stores its current history again.")}</p>
            </>
          )}
          {deleteError && <div role="alert">{uiText("Could not clear saved edit history.")}<ErrorDetails detail={deleteError} /></div>}
          <div className="about-dialog-actions">
            <button ref={cancel} type="button" disabled={deleting} onClick={dismissConfirmation}>{uiText("Cancel")}</button>
            <button type="button" disabled={deleting || (confirmation.kind === "batch" && estimate === undefined)}
              onClick={() => void confirmDelete()}>
              {uiText(deleting ? "Clearing edit history…" : "Clear")}
            </button>
          </div>
        </Dialog>
      )}
    </Dialog>
  );
}
