import type { FileInfo } from "../types";
import { toBase64 } from "./imageImport";

export type AttachmentDownloadEvent = "started" | "completed" | "failed";

type ChooseDestination = (fileName: string) => Promise<string | null>;
type SaveAttachment = (path: string, base64: string) => Promise<void>;
type NotifyDownload = (event: AttachmentDownloadEvent, fileName: string) => void;

function attachmentBase64(file: FileInfo): string {
  if (file.base64 !== null) return file.base64;
  return toBase64(new TextEncoder().encode(file.content ?? ""));
}

export async function downloadAttachment(
  file: FileInfo,
  chooseDestination: ChooseDestination,
  save: SaveAttachment,
  notify: NotifyDownload,
): Promise<boolean> {
  const fileName = file.path.slice(file.path.lastIndexOf("/") + 1);
  const destination = await chooseDestination(fileName);
  if (destination === null) return false;
  notify("started", fileName);
  try {
    await save(destination, attachmentBase64(file));
    notify("completed", fileName);
    return true;
  } catch (error) {
    notify("failed", fileName);
    throw error;
  }
}
