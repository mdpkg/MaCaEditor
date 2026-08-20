import { invoke } from "@tauri-apps/api/core";
import type { ImportedImage, PackageInfo, SaveRequest } from "../types";

export function openPackage(path: string): Promise<PackageInfo> {
  return invoke("open_package", { path });
}

export function savePackage(request: SaveRequest): Promise<void> {
  return invoke("save_package", { request });
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
