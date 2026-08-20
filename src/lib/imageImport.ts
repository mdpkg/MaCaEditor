import type { ImportedImage } from "../types";

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

export async function droppedFileToImage(file: File): Promise<ImportedImage> {
  if (!isSupportedImageName(file.name)) throw new Error(`Unsupported image type: ${file.name}`);
  return {
    file_name: file.name,
    base64: toBase64(new Uint8Array(await file.arrayBuffer())),
  };
}
