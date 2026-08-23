import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AiConfig,
  FolderSaveRequest,
  ImportedFile,
  ImportedImage,
  PackageInfo,
  SaveRequest,
} from "../types";

export function openPackage(path: string): Promise<PackageInfo> {
  return invoke("open_package", { path });
}

export function openFolder(path: string): Promise<PackageInfo> {
  return invoke("open_folder", { path });
}

export function createEmptyFolder(path: string): Promise<PackageInfo> {
  return invoke("create_empty_folder", { path });
}

export function savePackage(request: SaveRequest): Promise<void> {
  return invoke("save_package", { request });
}

export function saveFolder(request: FolderSaveRequest): Promise<void> {
  return invoke("save_folder", { request });
}

export function exportPackage(request: SaveRequest): Promise<void> {
  return invoke("export_package", { request });
}

export function createNewPackage(path: string): Promise<void> {
  return invoke("create_new_package", { path });
}

export function importFolder(folder: string, dest: string): Promise<void> {
  return invoke("import_folder", { folder, dest });
}

export function exportFolder(packagePath: string, dest: string): Promise<void> {
  return invoke("export_folder", { packagePath, dest });
}

export function readImage(path: string): Promise<ImportedImage> {
  return invoke("read_image", { path });
}

export function readAttachment(path: string): Promise<ImportedFile> {
  return invoke("read_attachment", { path });
}

export function saveAttachment(path: string, base64: string): Promise<void> {
  return invoke("save_attachment", { path, base64 });
}

export function watchFolder(path: string): Promise<void> {
  return invoke("watch_folder", { path });
}

export function stopWatchingFolder(): Promise<void> {
  return invoke("stop_watching_folder");
}

export function onFolderChanged(handler: (path: string) => void): Promise<UnlistenFn> {
  return listen<{ path: string }>("folder-changed", (event) => handler(event.payload.path));
}

export function saveAiConfig(config: AiConfig): Promise<void> {
  return invoke("save_ai_config", { config });
}

export function loadAiConfig(): Promise<AiConfig> {
  return invoke("load_ai_config");
}
