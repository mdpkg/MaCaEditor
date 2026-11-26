import type { EditHistoryEntry, HistoryDirection } from "./editHistory";
import type { ChatPathChange } from "./aiChatSessions";
export type ChatPathMove = { from: string; to: string };
/** Moves are runtime metadata from a successful operation, never inferred from contents. */
export function chatHistoryPathChanges(entry: EditHistoryEntry, direction: HistoryDirection, moves: ChatPathMove[] = []): ChatPathChange[] {
  if (entry.kind !== "files") return [];
  const relocated = direction === "undo" ? moves.map(({ from, to }) => ({ from: to, to: from })) : moves;
  const removed = entry.files.filter((change) => direction === "undo" ? change.after && !change.before : change.before && !change.after)
    .map((change) => ({ from: change.path }));
  return [...relocated, ...removed];
}
