export interface FileInfo {
  path: string;
  is_text: boolean;
  content: string | null;
  base64: string | null;
}

export interface PackageInfo {
  manifest: Record<string, unknown>;
  entrypoint: string;
  files: FileInfo[];
  manifest_generated?: boolean;
}

export interface FileContent {
  path: string;
  is_text: boolean;
  content: string | null;
  base64: string | null;
}

export interface SaveRequest {
  path: string;
  manifest: Record<string, unknown>;
  files: FileContent[];
}

export interface FolderSaveRequest extends SaveRequest {
  original_paths: string[];
}

export interface ImportedFile {
  file_name: string;
  base64: string;
}

export type ImportedImage = ImportedFile;

export type AiProviderKind = "OpenAiCompatible";

export interface AiConfig {
  provider: AiProviderKind;
  base_url: string;
  api_key: string | null;
  model: string;
  temperature: number | null;
  max_output_tokens: number | null;
  connect_timeout_seconds: number | null;
  request_timeout_seconds: number | null;
}

export type AiRole = "System" | "User" | "Assistant";

export interface AiMessage {
  role: AiRole;
  content: string;
}

export interface AiRequest {
  messages: AiMessage[];
  temperature?: number | null;
  max_output_tokens?: number | null;
}

export type AiStreamEvent =
  | { type: "started"; request_id: string }
  | { type: "delta"; request_id: string; content: string }
  | { type: "completed"; request_id: string }
  | { type: "cancelled"; request_id: string }
  | { type: "error"; request_id: string; error: AiError };

export type AiError =
  | { kind: "InvalidConfiguration"; message: string }
  | { kind: "ConnectionFailed"; message: string }
  | { kind: "AuthenticationFailed"; message: string }
  | { kind: "PermissionDenied"; message: string }
  | { kind: "ModelNotFound"; message: string }
  | { kind: "RateLimited"; message: string }
  | { kind: "Timeout"; message: string }
  | { kind: "ServerError"; message: string }
  | { kind: "InvalidResponse"; message: string }
  | { kind: "Cancelled" }
  | { kind: "Unknown"; message: string };
