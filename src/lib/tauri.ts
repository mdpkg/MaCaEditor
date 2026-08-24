import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AiConfig,
  AiRequest,
  AiStreamEvent,
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

export function listAiModels(
  baseUrl: string,
  apiKey: string | null,
): Promise<string[]> {
  return invoke("list_ai_models", { baseUrl, apiKey });
}

export function testAiConnection(
  baseUrl: string,
  apiKey: string | null,
  model: string,
): Promise<void> {
  return invoke("test_ai_connection", { baseUrl, apiKey, model });
}

export function startAiStream(
  options: {
    baseUrl: string;
    apiKey: string | null;
    model: string;
    request: AiRequest;
    connectTimeoutSeconds?: number | null;
    requestTimeoutSeconds?: number | null;
  },
  onEvent: (event: AiStreamEvent) => void,
): Promise<string> {
  const channel = new Channel<AiStreamEvent>((event) => onEvent(event));
  return invoke("ai_stream", {
    channel,
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
    model: options.model,
    request: options.request,
    connectTimeoutSeconds: options.connectTimeoutSeconds ?? null,
    requestTimeoutSeconds: options.requestTimeoutSeconds ?? null,
  });
}

export function cancelAiRequest(requestId: string): Promise<boolean> {
  return invoke("cancel_ai_request", { requestId });
}

export function startAiDiagramEdit(options: {
  baseUrl: string; apiKey: string | null; model: string; format: "plantuml" | "mermaid";
  currentSource: string; instruction: string;
  connectTimeoutSeconds?: number | null; requestTimeoutSeconds?: number | null;
}, onEvent: (event: AiStreamEvent) => void): Promise<string> {
  const channel = new Channel<AiStreamEvent>((event) => onEvent(event));
  return invoke("ai_edit_diagram", { channel, baseUrl: options.baseUrl, apiKey: options.apiKey,
    model: options.model, format: options.format, currentSource: options.currentSource,
    instruction: options.instruction, connectTimeoutSeconds: options.connectTimeoutSeconds ?? null,
    requestTimeoutSeconds: options.requestTimeoutSeconds ?? null });
}

/** 最新の editor 内容と正常な会話履歴を使って document chat を開始する。 */
export function startAiDocumentChat(
  options: {
    baseUrl: string; apiKey: string | null; model: string;
    filename: string; currentDocument: string; history: AiRequest["messages"];
    question: string; connectTimeoutSeconds?: number | null; requestTimeoutSeconds?: number | null;
  },
  onEvent: (event: AiStreamEvent) => void,
): Promise<string> {
  const channel = new Channel<AiStreamEvent>((event) => onEvent(event));
  return invoke("ai_document_chat", {
    channel,
    baseUrl: options.baseUrl, apiKey: options.apiKey, model: options.model,
    filename: options.filename, currentDocument: options.currentDocument,
    history: options.history, question: options.question,
    connectTimeoutSeconds: options.connectTimeoutSeconds ?? null,
    requestTimeoutSeconds: options.requestTimeoutSeconds ?? null,
  });
}

export type AiTaskKind = "Rewrite" | "Summarize" | "Proofread";

/** 選択テキストを対象とした AI タスクを実行する。戻り値は request ID。 */
export function startAiSelectionAction(
  options: {
    baseUrl: string;
    apiKey: string | null;
    model: string;
    task: AiTaskKind;
    selectedText: string;
    connectTimeoutSeconds?: number | null;
    requestTimeoutSeconds?: number | null;
  },
  onEvent: (event: AiStreamEvent) => void,
): Promise<string> {
  const channel = new Channel<AiStreamEvent>((event) => onEvent(event));
  return invoke("ai_selection_action", {
    channel,
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
    model: options.model,
    task: options.task,
    selectedText: options.selectedText,
    connectTimeoutSeconds: options.connectTimeoutSeconds ?? null,
    requestTimeoutSeconds: options.requestTimeoutSeconds ?? null,
  });
}
