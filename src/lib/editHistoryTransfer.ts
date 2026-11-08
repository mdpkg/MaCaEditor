import { invoke } from "@tauri-apps/api/core";
import type { PackageInfo, SaveOutcome, SaveRequest } from "../types";

// Each chunk encodes whole Base64 groups, except the last chunk of an attachment.
const chunkBytes = 3 * 2 ** 20;
const chunkCharacters = chunkBytes / 3 * 4;
const inlineCharacters = 16 * 2 ** 20;
const concurrentAttachments = 4;

type PackageWithDownload = PackageInfo & { edit_history_download?: { id: number; sizes: number[] } };
type Base64Bytes = Uint8Array & { toBase64?: () => string };
const ByteArray = Uint8Array as typeof Uint8Array & { fromBase64?: (text: string) => Uint8Array };

function decodeBase64(value: string): Uint8Array {
  return ByteArray.fromBase64?.(value) ?? Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function encodeBase64(value: Base64Bytes): string {
  if (value.toBase64) return value.toBase64();
  const parts: string[] = [];
  for (let offset = 0; offset < value.length; offset += 0x8000) {
    parts.push(String.fromCharCode(...value.subarray(offset, offset + 0x8000)));
  }
  return btoa(parts.join(""));
}

function binarySize(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return value.length * 3 / 4 - padding;
}

function discardUpload(token: string) {
  return invoke("discard_edit_history_upload", { token }).catch(() => {});
}

async function transferAttachments<Input, Output>(
  attachments: Input[],
  transfer: (value: Input, index: number) => Promise<Output>,
): Promise<Output[]> {
  const results: Output[] = [];
  for (let start = 0; start < attachments.length; start += concurrentAttachments) {
    const group = attachments.slice(start, start + concurrentAttachments);
    // Drain in-flight chunks before cleaning up a failed upload.
    const transferred = await Promise.allSettled(group.map((value, index) => transfer(value, start + index)));
    for (const item of transferred) {
      if (item.status === "rejected") throw item.reason;
      results.push(item.value);
    }
  }
  return results;
}

export async function saveWithEditHistory(command: string, request: SaveRequest): Promise<SaveOutcome> {
  const { edit_history: checkpoint, ...document } = request;
  if (!checkpoint || checkpoint.attachments.reduce((sum, value) => sum + value.length, 0) <= inlineCharacters) {
    return invoke(command, { request });
  }

  let token: string | undefined;
  try {
    const upload = await invoke<string>("begin_edit_history_upload", { sizes: checkpoint.attachments.map(binarySize) });
    token = upload;
    await transferAttachments(checkpoint.attachments, async (value, index) => {
      for (let position = 0; position < value.length; position += chunkCharacters) {
        const bytes = decodeBase64(value.slice(position, position + chunkCharacters));
        await invoke("upload_edit_history_chunk", bytes, { headers: {
          "x-history-upload": upload,
          "x-history-index": String(index),
          "x-history-offset": String(position * 3 / 4),
        } });
      }
    });
  } catch (error) {
    if (token) await discardUpload(token);
    const outcome = await invoke<SaveOutcome>(command, { request: document });
    return { ...outcome, edit_history_warning: String(error) };
  }

  try {
    return await invoke(command, {
      request: { ...document, edit_history: { data: checkpoint.data, attachments: [] } },
      editHistoryUpload: token,
    });
  } finally {
    await discardUpload(token);
  }
}

export async function readEditHistory(response: Promise<PackageWithDownload>): Promise<PackageInfo> {
  const { edit_history_download: download, ...info } = await response;
  if (!download || !info.edit_history) return info;
  const { edit_history: checkpoint, ...document } = info;
  try {
    const attachments = await transferAttachments(download.sizes, async (size, index) => {
      const chunks: string[] = [];
      for (let offset = 0; offset < size; offset += chunkBytes) {
        const data = await invoke<ArrayBuffer | number[]>("read_edit_history_chunk", { id: download.id, index, offset });
        const bytes = Array.isArray(data) ? Uint8Array.from(data) : new Uint8Array(data);
        if (bytes.byteLength !== Math.min(chunkBytes, size - offset)) throw new Error("Incomplete edit history attachment");
        chunks.push(encodeBase64(bytes));
      }
      return chunks.join("");
    });
    return { ...document, edit_history: { data: checkpoint.data, attachments } };
  } catch (error) {
    return { ...document, edit_history_warning: String(error) };
  }
}
