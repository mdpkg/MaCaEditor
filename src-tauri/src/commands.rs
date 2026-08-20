use std::path::PathBuf;

use crate::atomic_save::atomic_save;
use crate::package_loader::{load_package, LoadedPackage};
use crate::package_writer::write_package;

#[derive(Debug, serde::Serialize)]
pub struct FileInfo {
    pub path: String,
    pub is_text: bool,
    pub content: Option<String>,
    pub base64: Option<String>,
}

#[derive(Debug, serde::Serialize)]
pub struct PackageInfo {
    pub manifest: serde_json::Value,
    pub entrypoint: String,
    pub files: Vec<FileInfo>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct SaveRequest {
    pub path: String,
    pub manifest: serde_json::Value,
    pub files: Vec<FileContent>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct FileContent {
    pub path: String,
    pub is_text: bool,
    pub content: Option<String>,
    pub base64: Option<String>,
}

#[derive(Debug, serde::Serialize)]
pub struct ImportedImage {
    pub file_name: String,
    pub base64: String,
}

#[tauri::command]
pub fn read_image(path: String) -> Result<ImportedImage, String> {
    let source = PathBuf::from(&path);
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or("image file must have an extension")?;
    if !matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp") {
        return Err(format!("unsupported image type: .{extension}"));
    }
    let file_name = source
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or("invalid image file name")?
        .to_string();
    let data = std::fs::read(&source).map_err(|e| e.to_string())?;
    Ok(ImportedImage {
        file_name,
        base64: encode_base64(&data),
    })
}

fn to_file_info(file: &crate::package_file::PackageFile) -> FileInfo {
    if file.is_text() {
        FileInfo {
            path: file.path.clone(),
            is_text: true,
            content: file.text_content().map(|s| s.to_string()),
            base64: None,
        }
    } else {
        FileInfo {
            path: file.path.clone(),
            is_text: false,
            content: None,
            base64: Some(encode_base64(&file.content)),
        }
    }
}

fn encode_base64(data: &[u8]) -> String {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD.encode(data)
}

/// `.mdpkg` を開く Tauri コマンド。
#[tauri::command]
pub fn open_package(path: String) -> Result<PackageInfo, String> {
    let data = std::fs::read(&path).map_err(|e| e.to_string())?;
    let loaded: LoadedPackage = load_package(&data).map_err(|e| e.to_string())?;

    let files: Vec<FileInfo> = loaded.files.iter().map(to_file_info).collect();
    let manifest = serde_json::to_value(&loaded.manifest).map_err(|e| e.to_string())?;

    Ok(PackageInfo {
        manifest,
        entrypoint: loaded.manifest.entrypoint.clone(),
        files,
    })
}

/// Document Model を `.mdpkg` として保存する Tauri コマンド。
#[tauri::command]
pub fn save_package(request: SaveRequest) -> Result<(), String> {
    let manifest = crate::manifest::Manifest::parse(&request.manifest.to_string())
        .map_err(|e| e.to_string())?;

    let mut files: Vec<crate::package_file::PackageFile> = Vec::new();
    for f in request.files {
        let content = if f.is_text {
            f.content.unwrap_or_default().into_bytes()
        } else {
            decode_base64(&f.base64.unwrap_or_default()).map_err(|e| e.to_string())?
        };
        let file = if f.is_text {
            crate::package_file::PackageFile::new_text(f.path, String::from_utf8(content).map_err(|e| e.to_string())?)
        } else {
            crate::package_file::PackageFile::new_binary(f.path, content)
        };
        files.push(file);
    }

    let zip = write_package(&manifest, &files).map_err(|e| e.to_string())?;
    atomic_save(&PathBuf::from(&request.path), &zip).map_err(|e| e.to_string())?;
    Ok(())
}

fn decode_base64(data: &str) -> Result<Vec<u8>, String> {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| e.to_string())
}

/// 新規 Markdown Package を作成する Tauri コマンド。
#[tauri::command]
pub fn create_new_package(path: String) -> Result<(), String> {
    let manifest_json = r#"{
        "format": "mdpkg",
        "version": "1.0",
        "entrypoint": "README.md",
        "title": "Untitled"
    }"#;
    let manifest = crate::manifest::Manifest::parse(manifest_json).map_err(|e| e.to_string())?;
    let files = vec![crate::package_file::PackageFile::new_text(
        "README.md".to_string(),
        "# Untitled".to_string(),
    )];
    let zip = write_package(&manifest, &files).map_err(|e| e.to_string())?;
    atomic_save(&PathBuf::from(&path), &zip).map_err(|e| e.to_string())?;
    Ok(())
}

/// フォルダから `.mdpkg` を作成する Tauri コマンド。
#[tauri::command]
pub fn import_folder(folder: String, dest: String) -> Result<(), String> {
    let mut files: Vec<crate::package_file::PackageFile> = Vec::new();
    let mut manifest_json: Option<String> = None;

    let base = PathBuf::from(&folder);
    collect_folder(&base, &base, &mut files, &mut manifest_json).map_err(|e| e.to_string())?;

    let manifest_json = manifest_json.ok_or("manifest.json is missing")?;
    let manifest = crate::manifest::Manifest::parse(&manifest_json).map_err(|e| e.to_string())?;

    let zip = write_package(&manifest, &files).map_err(|e| e.to_string())?;
    atomic_save(&PathBuf::from(&dest), &zip).map_err(|e| e.to_string())?;
    Ok(())
}

fn collect_folder(
    base: &PathBuf,
    dir: &PathBuf,
    files: &mut Vec<crate::package_file::PackageFile>,
    manifest_json: &mut Option<String>,
) -> Result<(), std::io::Error> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            collect_folder(base, &path, files, manifest_json)?;
        } else {
            let rel = path
                .strip_prefix(base)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
            let rel_str = rel.to_string_lossy().replace('\\', "/");
            let content = std::fs::read(&path)?;
            let file = if is_text_path(&rel_str) {
                match String::from_utf8(content.clone()) {
                    Ok(text) => crate::package_file::PackageFile::new_text(rel_str.clone(), text),
                    Err(_) => crate::package_file::PackageFile::new_binary(rel_str.clone(), content),
                }
            } else {
                crate::package_file::PackageFile::new_binary(rel_str.clone(), content)
            };
            if rel_str == "manifest.json" {
                *manifest_json = Some(
                    String::from_utf8(file.content.clone())
                        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?,
                );
            }
            files.push(file);
        }
    }
    Ok(())
}

fn is_text_path(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.ends_with(".md")
        || lower.ends_with(".markdown")
        || lower.ends_with(".json")
        || lower.ends_with(".yaml")
        || lower.ends_with(".yml")
        || lower.ends_with(".puml")
        || lower.ends_with(".mmd")
        || lower.ends_with(".dot")
        || lower.ends_with(".svg")
        || lower.ends_with(".txt")
        || lower.ends_with(".toml")
}

/// `.mdpkg` をフォルダへ展開する Tauri コマンド。
#[tauri::command]
pub fn export_folder(package_path: String, dest: String) -> Result<(), String> {
    let data = std::fs::read(&package_path).map_err(|e| e.to_string())?;
    let loaded = load_package(&data).map_err(|e| e.to_string())?;
    let dest = PathBuf::from(&dest);
    std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
    for file in &loaded.files {
        let target = dest.join(file.path.replace('\\', "/"));
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&target, &file.content).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// アプリの状態を管理するためのセットアップ。
pub fn setup(app: &mut tauri::App) {
    let _ = app;
}
