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
}
