import type { ImportedImage } from "../types";
import { imageMediaType } from "./document";

export function isSupportedImageName(name: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp)$/i.test(name);
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export function importedImageDataUrl(image: ImportedImage): string {
  return `data:${imageMediaType(image.file_name)};base64,${image.base64}`;
}

export async function droppedFileToImage(file: File): Promise<ImportedImage> {
  if (!isSupportedImageName(file.name)) throw new Error(`Unsupported image type: ${file.name}`);
  return {
    file_name: file.name,
    base64: toBase64(new Uint8Array(await file.arrayBuffer())),
  };
}

const clipboardImageExtensions = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
  ["image/bmp", "bmp"],
]);

export async function clipboardBlobToImage(blob: Blob): Promise<ImportedImage> {
  const extension = clipboardImageExtensions.get(blob.type);
  if (!extension) throw new Error(`Unsupported image type: ${blob.type}`);
  return {
    file_name: `pasted-image.${extension}`,
    base64: toBase64(new Uint8Array(await blob.arrayBuffer())),
  };
}

export async function readImageOrTextClipboard(clipboard: Clipboard): Promise<ImportedImage[] | string> {
  const items = await clipboard.read?.().catch(() => []);
  const images = (items ?? []).flatMap((item) => {
    const type = item.types.find((candidate) => clipboardImageExtensions.has(candidate))
      ?? item.types.find((candidate) => candidate.startsWith("image/"));
    return type ? [item.getType(type).then(clipboardBlobToImage)] : [];
  });
  return images.length > 0 ? Promise.all(images) : clipboard.readText();
}
