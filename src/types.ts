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
