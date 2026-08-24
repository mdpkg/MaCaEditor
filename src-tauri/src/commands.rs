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
pub struct FolderSaveRequest {
    pub path: String,
    pub manifest: serde_json::Value,
    pub files: Vec<FileContent>,
    pub original_paths: Vec<String>,
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
    if !matches!(
        extension.as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp"
    ) {
        return Err(format!("unsupported image type: .{extension}"));
    }
    read_imported_file(&source)
}

#[tauri::command]
pub fn read_attachment(path: String) -> Result<ImportedImage, String> {
    read_imported_file(&PathBuf::from(path))
}

#[tauri::command]
pub fn save_attachment(path: String, base64: String) -> Result<(), String> {
    let data = decode_base64(&base64)?;
    atomic_save(&PathBuf::from(path), &data).map_err(|error| error.to_string())
}

fn read_imported_file(source: &PathBuf) -> Result<ImportedImage, String> {
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

#[tauri::command]
pub fn open_folder(path: String) -> Result<PackageInfo, String> {
    let loaded =
        crate::folder_document::load_folder(&PathBuf::from(path)).map_err(|e| e.to_string())?;
    folder_package_info(loaded)
}

#[tauri::command]
pub fn create_empty_folder(path: String) -> Result<PackageInfo, String> {
    let loaded = crate::folder_document::create_empty_folder(&PathBuf::from(path))
        .map_err(|e| e.to_string())?;
    folder_package_info(loaded)
}

fn folder_package_info(
    loaded: crate::folder_document::FolderDocument,
) -> Result<PackageInfo, String> {
    let files = loaded.files.iter().map(to_file_info).collect();
    let manifest = serde_json::to_value(&loaded.manifest).map_err(|e| e.to_string())?;
    Ok(PackageInfo {
        entrypoint: loaded.manifest.entrypoint.clone(),
        manifest,
        files,
    })
}

/// Document Model を `.mdpkg` として保存する Tauri コマンド。
#[tauri::command]
pub fn save_package(request: SaveRequest) -> Result<(), String> {
    let manifest = parse_manifest(&request.manifest)?;
    let files = parse_files(request.files)?;

    let zip = write_package(&manifest, &files).map_err(|e| e.to_string())?;
    atomic_save(&PathBuf::from(&request.path), &zip).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn save_folder(request: FolderSaveRequest) -> Result<(), String> {
    let manifest = parse_manifest(&request.manifest)?;
    let files = parse_files(request.files)?;
    crate::folder_document::save_folder(
        &PathBuf::from(request.path),
        &manifest,
        &files,
        &request.original_paths,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_package(request: SaveRequest) -> Result<(), String> {
    let manifest = parse_manifest(&request.manifest)?;
    let files = parse_files(request.files)?;
    crate::folder_document::validate_document(&manifest, &files).map_err(|e| e.to_string())?;
    let zip = write_package(&manifest, &files).map_err(|e| e.to_string())?;
    atomic_save(&PathBuf::from(request.path), &zip).map_err(|e| e.to_string())
}

fn parse_manifest(value: &serde_json::Value) -> Result<crate::manifest::Manifest, String> {
    crate::manifest::Manifest::parse(&value.to_string()).map_err(|e| e.to_string())
}

fn parse_files(files: Vec<FileContent>) -> Result<Vec<crate::package_file::PackageFile>, String> {
    files
        .into_iter()
        .map(|f| {
            crate::path_validator::validate_package_path(&f.path).map_err(|e| e.to_string())?;
            if f.is_text {
                Ok(crate::package_file::PackageFile::new_text(
                    f.path,
                    f.content.unwrap_or_default(),
                ))
            } else {
                Ok(crate::package_file::PackageFile::new_binary(
                    f.path,
                    decode_base64(&f.base64.unwrap_or_default())?,
                ))
            }
        })
        .collect()
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
                    Err(_) => {
                        crate::package_file::PackageFile::new_binary(rel_str.clone(), content)
                    }
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
    let manifest = serde_json::to_vec_pretty(&loaded.manifest).map_err(|e| e.to_string())?;
    atomic_save(&dest.join("manifest.json"), &manifest).map_err(|e| e.to_string())?;
    for file in &loaded.files {
        let target = dest.join(file.path.replace('\\', "/"));
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&target, &file.content).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// AI 設定を保存する Tauri コマンド。
#[tauri::command]
pub fn save_ai_config(config: crate::ai::config::AiConfig) -> Result<(), String> {
    crate::ai::storage::save_ai_config(&config)
}

/// AI 設定を読み込む Tauri コマンド。
#[tauri::command]
pub fn load_ai_config() -> Result<crate::ai::config::AiConfig, String> {
    crate::ai::storage::load_ai_config()
}

/// Model 一覧を取得する Tauri コマンド。
#[tauri::command]
pub async fn list_ai_models(
    base_url: String,
    api_key: Option<String>,
) -> Result<Vec<String>, String> {
    let provider = crate::ai::openai::OpenAiCompatibleProvider::new(&base_url, api_key.as_deref());
    provider
        .list_models()
        .await
        .map_err(|e| e.to_string())
}

/// 接続テストを実行する Tauri コマンド。
#[tauri::command]
pub async fn test_ai_connection(
    base_url: String,
    api_key: Option<String>,
    model: String,
) -> Result<(), String> {
    let provider = crate::ai::openai::OpenAiCompatibleProvider::new(&base_url, api_key.as_deref());
    provider
        .test_connection(&model)
        .await
        .map_err(|e| e.to_string())
}

/// AI ストリーミングを開始する Tauri コマンド。
/// Channel へ `AiStreamEvent` を逐次送信する。戻り値は発行した request ID。
#[tauri::command]
pub async fn ai_stream(
    state: tauri::State<'_, crate::ai::commands::AiStreamState>,
    channel: tauri::ipc::Channel<crate::ai::types::AiStreamEvent>,
    base_url: String,
    api_key: Option<String>,
    model: String,
    request: crate::ai::types::AiRequest,
    connect_timeout_seconds: Option<u64>,
    request_timeout_seconds: Option<u64>,
) -> Result<String, String> {
    let provider = crate::ai::openai::OpenAiCompatibleProvider::new(&base_url, api_key.as_deref()).with_model(model);
    let coordinator = crate::ai::streaming::AiStreamCoordinator::with_registry(
        provider,
        state.registry.clone(),
    );
    let sender = move |event: crate::ai::types::AiStreamEvent| {
        let _ = channel.send(event);
    };
    crate::ai::commands::run_ai_stream(
        &coordinator,
        sender,
        request,
        connect_timeout_seconds,
        request_timeout_seconds,
    )
    .await
    .map_err(|e| e.to_string())
}

/// 選択テキストを対象とした AI タスクを実行する Tauri コマンド。
/// task 固有の prompt は Rust 側 PromptBuilder で組み立て、UI 層には置かない。
#[tauri::command]
pub async fn ai_selection_action(
    state: tauri::State<'_, crate::ai::commands::AiStreamState>,
    channel: tauri::ipc::Channel<crate::ai::types::AiStreamEvent>,
    base_url: String,
    api_key: Option<String>,
    model: String,
    task: crate::ai::prompt::AiTaskKind,
    selected_text: String,
    connect_timeout_seconds: Option<u64>,
    request_timeout_seconds: Option<u64>,
) -> Result<String, String> {
    let request = crate::ai::prompt::build_request(task, &selected_text);
    let provider = crate::ai::openai::OpenAiCompatibleProvider::new(&base_url, api_key.as_deref()).with_model(model);
    let coordinator = crate::ai::streaming::AiStreamCoordinator::with_registry(
        provider,
        state.registry.clone(),
    );
    let sender = move |event: crate::ai::types::AiStreamEvent| {
        let _ = channel.send(event);
    };
    crate::ai::commands::run_ai_stream(
        &coordinator,
        sender,
        request,
        connect_timeout_seconds,
        request_timeout_seconds,
    )
    .await
    .map_err(|e| e.to_string())
}

/// 現在編集中の Markdown をコンテキストにした read-only chat を開始する。
#[tauri::command]
pub async fn ai_document_chat(
    state: tauri::State<'_, crate::ai::commands::AiStreamState>,
    channel: tauri::ipc::Channel<crate::ai::types::AiStreamEvent>,
    base_url: String,
    api_key: Option<String>,
    model: String,
    filename: String,
    current_document: String,
    history: Vec<crate::ai::types::AiMessage>,
    question: String,
    connect_timeout_seconds: Option<u64>,
    request_timeout_seconds: Option<u64>,
) -> Result<String, String> {
    let request = crate::ai::prompt::build_document_chat_request(
        &filename, &current_document, &history, &question,
    );
    let provider = crate::ai::openai::OpenAiCompatibleProvider::new(&base_url, api_key.as_deref()).with_model(model);
    let coordinator = crate::ai::streaming::AiStreamCoordinator::with_registry(
        provider, state.registry.clone(),
    );
    crate::ai::commands::run_ai_stream(
        &coordinator,
        move |event| { let _ = channel.send(event); },
        request,
        connect_timeout_seconds,
        request_timeout_seconds,
    ).await.map_err(|error| error.to_string())
}

/// request ID を指定して実行中の AI ストリームをキャンセルする Tauri コマンド。
/// 存在しない ID は idempotent に成功扱いする。
#[tauri::command]
pub fn cancel_ai_request(
    state: tauri::State<'_, crate::ai::commands::AiStreamState>,
    request_id: String,
) -> Result<bool, String> {
    Ok(state.registry.cancel(&request_id))
}

/// アプリの状態を管理するためのセットアップ。
pub fn setup(app: &mut tauri::App) {
    let _ = app;
}

#[cfg(test)]
mod tests {
    use super::{
        export_folder, export_package, read_attachment, save_attachment, FileContent, SaveRequest,
    };
    use std::path::PathBuf;

    fn temporary_attachment_path() -> PathBuf {
        std::env::temp_dir().join(format!(
            "maca-attachment-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn reads_an_arbitrary_attachment_as_base64() {
        let path = temporary_attachment_path();
        std::fs::write(&path, [1_u8, 2, 3]).unwrap();

        let imported = read_attachment(path.to_string_lossy().into_owned()).unwrap();

        assert_eq!(
            imported.file_name,
            path.file_name().unwrap().to_string_lossy()
        );
        assert_eq!(imported.base64, "AQID");
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn saves_a_base64_attachment_to_the_selected_path() {
        let path = temporary_attachment_path();

        save_attachment(path.to_string_lossy().into_owned(), "AQID".to_string()).unwrap();

        assert_eq!(std::fs::read(&path).unwrap(), [1_u8, 2, 3]);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn exports_a_valid_document_as_mdpkg() {
        let path = temporary_attachment_path().with_extension("mdpkg");
        let request = SaveRequest {
            path: path.to_string_lossy().into_owned(),
            manifest: serde_json::json!({
                "format": "mdpkg", "version": "1.0", "entrypoint": "README.md", "title": "T"
            }),
            files: vec![FileContent {
                path: "README.md".into(),
                is_text: true,
                content: Some("# Hello".into()),
                base64: None,
            }],
        };
        export_package(request).unwrap();
        let bytes = std::fs::read(&path).unwrap();
        let loaded = crate::package_loader::load_package(&bytes).unwrap();
        assert_eq!(loaded.manifest.entrypoint, "README.md");
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn export_folder_includes_manifest_json() {
        let package_path = temporary_attachment_path().with_extension("mdpkg");
        let dest = temporary_attachment_path().with_extension("folder");
        export_package(SaveRequest {
            path: package_path.to_string_lossy().into_owned(),
            manifest: serde_json::json!({
                "format": "mdpkg", "version": "1.0", "entrypoint": "README.md",
                "title": "Exported", "custom": 42
            }),
            files: vec![FileContent {
                path: "README.md".into(),
                is_text: true,
                content: Some("# Exported".into()),
                base64: None,
            }],
        })
        .unwrap();

        export_folder(
            package_path.to_string_lossy().into_owned(),
            dest.to_string_lossy().into_owned(),
        )
        .unwrap();

        let manifest: serde_json::Value =
            serde_json::from_slice(&std::fs::read(dest.join("manifest.json")).unwrap()).unwrap();
        assert_eq!(manifest["format"], "mdpkg");
        assert_eq!(manifest["custom"], 42);
        assert_eq!(
            std::fs::read_to_string(dest.join("README.md")).unwrap(),
            "# Exported"
        );
        std::fs::remove_file(package_path).unwrap();
        std::fs::remove_dir_all(dest).unwrap();
    }
}
