use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_fs::FsExt;

use crate::ai::error::AiError;
use crate::atomic_save::atomic_save;
use crate::bounded_io::{read_file, MAX_DOCUMENT_BYTES, MAX_FILE_BYTES};
use crate::image_formats::supported_image_extension;
use crate::history_transfer::HistoryUpload;
use crate::history_storage::history_database;
use crate::package_loader::{load_package, LoadedPackage};
use crate::package_writer::write_package;
use crate::saved_history::{self, EditCheckpoint, PendingCheckpoint};

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
    pub manifest_generated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_revision: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub edit_history: Option<EditCheckpoint>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub edit_history_download: Option<saved_history::AttachmentDownload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub edit_history_warning: Option<String>,
}

#[derive(Debug, Default, serde::Serialize)]
pub struct SaveOutcome {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_revision: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub edit_history_warning: Option<String>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct SaveRequest {
    pub path: String,
    pub manifest: serde_json::Value,
    pub files: Vec<FileContent>,
    pub edit_history: Option<EditCheckpoint>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct FolderSaveRequest {
    pub path: String,
    pub manifest: serde_json::Value,
    pub files: Vec<FileContent>,
    pub edit_history: Option<EditCheckpoint>,
    pub original_paths: Vec<String>,
    pub expected_revision: String,
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
pub fn read_image(window: tauri::Window, path: String) -> Result<ImportedImage, String> {
    ensure_selected_path(&window.fs_scope(), Path::new(&path))?;
    read_image_at(path)
}

fn read_image_at(path: String) -> Result<ImportedImage, String> {
    let source = PathBuf::from(&path);
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or("image file must have an extension")?;
    if !supported_image_extension(&extension) {
        return Err(format!("unsupported image type: .{extension}"));
    }
    read_imported_file(&source)
}

#[tauri::command]
pub fn set_image_drop_enabled(app: tauri::AppHandle, enabled: bool) {
    #[cfg(windows)]
    crate::windows_drop::set_images_enabled(&app, enabled);
    #[cfg(not(windows))]
    let _ = (app, enabled);
}

#[tauri::command]
pub fn read_attachment(window: tauri::Window, path: String) -> Result<ImportedImage, String> {
    ensure_selected_path(&window.fs_scope(), Path::new(&path))?;
    read_imported_file(&PathBuf::from(path))
}

#[tauri::command]
pub fn save_attachment(window: tauri::Window, path: String, base64: String) -> Result<(), String> {
    ensure_selected_path(&window.fs_scope(), Path::new(&path))?;
    save_attachment_at(path, base64)
}

fn ensure_selected_path(scope: &tauri::fs::Scope, path: &Path) -> Result<(), String> {
    if !path.is_absolute() || !scope.is_allowed(path) {
        return Err("file access requires selecting or dropping the file first".into());
    }
    Ok(())
}

fn save_attachment_at(path: String, base64: String) -> Result<(), String> {
    if base64.len() as u64 > MAX_FILE_BYTES.div_ceil(3) * 4 {
        return Err("file exceeds the size limit".into());
    }
    let data = decode_base64(&base64)?;
    if data.len() as u64 > MAX_FILE_BYTES { return Err("file exceeds the size limit".into()); }
    atomic_save(&PathBuf::from(path), &data).map_err(|error| error.to_string())
}

fn read_imported_file(source: &PathBuf) -> Result<ImportedImage, String> {
    let file_name = source
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or("invalid image file name")?
        .to_string();
    let data = read_file(source, MAX_FILE_BYTES).map_err(|e| e.to_string())?;
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
pub async fn open_package(app: AppHandle, path: String) -> Result<PackageInfo, String> {
    let database = history_database(&app);
    tokio::task::spawn_blocking(move || open_package_at(Path::new(&path), database))
        .await
        .map_err(|error| format!("package open task failed: {error}"))?
}

fn open_package_at(path: &Path, database: Result<PathBuf, String>) -> Result<PackageInfo, String> {
    let data = read_file(path, MAX_DOCUMENT_BYTES).map_err(|e| e.to_string())?;
    let loaded: LoadedPackage = load_package(&data).map_err(|e| e.to_string())?;

    let files: Vec<FileInfo> = loaded.files.iter().map(to_file_info).collect();
    let manifest = serde_json::to_value(&loaded.manifest).map_err(|e| e.to_string())?;
    let mut info = PackageInfo {
        manifest,
        entrypoint: loaded.manifest.entrypoint.clone(),
        files,
        manifest_generated: false,
        folder_revision: None,
        edit_history: None,
        edit_history_download: None,
        edit_history_warning: None,
    };
    attach_saved_history(
        &mut info,
        database,
        "package",
        path,
        &saved_history::revision(&data),
    );
    Ok(info)
}

#[tauri::command]
pub async fn open_folder(
    app: AppHandle,
    path: String,
    with_edit_history: Option<bool>,
) -> Result<PackageInfo, String> {
    let database = with_edit_history
        .unwrap_or(false)
        .then(|| history_database(&app));
    tokio::task::spawn_blocking(move || open_folder_at(Path::new(&path), database))
        .await
        .map_err(|e| format!("folder scan failed: {e}"))?
}

fn open_folder_at(
    path: &Path,
    database: Option<Result<PathBuf, String>>,
) -> Result<PackageInfo, String> {
    let loaded = crate::folder_document::load_folder(path).map_err(|e| e.to_string())?;
    let revision = loaded.revision.clone();
    let mut info = folder_package_info(loaded)?;
    if let Some(database) = database {
        attach_saved_history(&mut info, database, "folder", path, &revision);
    }
    Ok(info)
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
        manifest_generated: loaded.manifest_was_generated,
        folder_revision: Some(loaded.revision),
        edit_history: None,
        edit_history_download: None,
        edit_history_warning: None,
    })
}

/// Document Model を `.mdpkg` として保存する Tauri コマンド。
#[tauri::command]
pub async fn save_package(
    app: AppHandle,
    request: SaveRequest,
    uploads: State<'_, HistoryUpload>,
    edit_history_upload: Option<String>,
) -> Result<SaveOutcome, String> {
    let save = prioritize_history_save(&app);
    let database = history_database(&app);
    let uploaded = edit_history_upload
        .map(|token| uploads.take(&token))
        .transpose();
    tokio::task::spawn_blocking(move || {
        let _save = save;
        save_package_at(request, database, uploaded)
    })
    .await
    .map_err(|error| format!("package save task failed: {error}"))?
}

fn save_package_at(
    request: SaveRequest,
    database: Result<PathBuf, String>,
    uploaded: Result<Option<Vec<Vec<u8>>>, String>,
) -> Result<SaveOutcome, String> {
    let manifest = parse_manifest(&request.manifest)?;
    let files = parse_files(request.files)?;
    crate::folder_document::validate_document(&manifest, &files).map_err(|e| e.to_string())?;
    let zip = write_package(&manifest, &files).map_err(|e| e.to_string())?;
    let path = Path::new(&request.path);
    let mut history = HistoryWrite::new(database, request.edit_history, uploaded);
    let revision = history.checkpoint.is_some().then(|| {
        let revision = saved_history::revision(&zip);
        let recoverable = saved_history::existing_revision(path)
            .is_ok_and(|old| old.as_deref() != Some(&revision));
        history.prepare("package", path, &revision, recoverable);
        revision
    });
    history.finish(
        atomic_save(path, &zip).map_err(|e| e.to_string()),
        revision.as_deref(),
    )?;
    Ok(SaveOutcome {
        edit_history_warning: history.warning,
        ..SaveOutcome::default()
    })
}

#[tauri::command]
pub async fn save_folder(
    app: AppHandle,
    request: FolderSaveRequest,
    uploads: State<'_, HistoryUpload>,
    edit_history_upload: Option<String>,
) -> Result<SaveOutcome, String> {
    let save = prioritize_history_save(&app);
    let database = history_database(&app);
    let uploaded = edit_history_upload
        .map(|token| uploads.take(&token))
        .transpose();
    tokio::task::spawn_blocking(move || {
        let _save = save;
        save_folder_at(request, database, uploaded)
    })
    .await
    .map_err(|error| format!("folder save task failed: {error}"))?
}

fn save_folder_at(
    request: FolderSaveRequest,
    database: Result<PathBuf, String>,
    uploaded: Result<Option<Vec<Vec<u8>>>, String>,
) -> Result<SaveOutcome, String> {
    let manifest = parse_manifest(&request.manifest)?;
    let files = parse_files(request.files)?;
    let path = Path::new(&request.path);
    let mut history = HistoryWrite::new(database, request.edit_history, uploaded);
    let result = crate::folder_document::save_folder_with_checkpoint(
        path,
        &manifest,
        &files,
        &request.original_paths,
        &request.expected_revision,
        |revision| {
            history.prepare(
                "folder",
                path,
                revision,
                revision != request.expected_revision,
            )
        },
    )
    .map_err(|error| error.to_string());
    let revision = result.as_ref().ok().cloned();
    let revision = history.finish(result, revision.as_deref())?;
    Ok(SaveOutcome {
        folder_revision: Some(revision),
        edit_history_warning: history.warning,
    })
}

#[tauri::command]
pub async fn clear_saved_edit_history(
    app: AppHandle,
    path: String,
    kind: String,
) -> Result<saved_history::ClearOutcome, String> {
    if !matches!(kind.as_str(), "package" | "folder") {
        return Err("unsupported edit history document kind".into());
    }
    let database = history_database(&app)?;
    let write = app.try_state::<crate::history_maintenance::HistoryMaintenance>()
        .map(|maintenance| maintenance.begin_write());
    tokio::task::spawn_blocking(move || {
        let _write = write;
        let document =
            saved_history::identity(&kind, Path::new(&path)).map_err(|e| e.to_string())?;
        saved_history::clear(&database, &document).map_err(|e| e.to_string())
    })
    .await
    .map_err(|error| format!("edit history clear task failed: {error}"))?
}

#[tauri::command]
pub async fn list_saved_edit_histories(app: AppHandle) -> Result<Vec<saved_history::SavedEditHistory>, String> {
    let database = history_database(&app)?;
    tokio::task::spawn_blocking(move || {
        saved_history::list_saved_edit_histories(&database).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("edit history listing task failed: {error}"))?
}

#[tauri::command]
pub async fn estimate_reclaimable_history_bytes(
    app: AppHandle,
    document_ids: Vec<String>,
) -> Result<i64, String> {
    let database = history_database(&app)?;
    tokio::task::spawn_blocking(move || {
        saved_history::estimate_reclaimable_history_bytes(&database, &document_ids)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("edit history size estimate task failed: {error}"))?
}

#[tauri::command]
pub async fn delete_saved_edit_history(app: AppHandle, document_id: String) -> Result<(), String> {
    let database = history_database(&app)?;
    let write = app.try_state::<crate::history_maintenance::HistoryMaintenance>()
        .map(|maintenance| maintenance.begin_write());
    tokio::task::spawn_blocking(move || {
        let _write = write;
        saved_history::delete_saved_edit_history(&database, &document_id)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("edit history deletion task failed: {error}"))?
}

#[tauri::command]
pub async fn delete_missing_saved_edit_histories(
    app: AppHandle,
    document_ids: Vec<String>,
    estimated_bytes: Option<i64>,
) -> Result<Vec<String>, String> {
    let database = history_database(&app)?;
    let write = app.try_state::<crate::history_maintenance::HistoryMaintenance>()
        .map(|maintenance| maintenance.begin_write());
    tokio::task::spawn_blocking(move || {
        let _write = write;
        let deletion = saved_history::delete_missing_saved_edit_histories(&database, &document_ids, estimated_bytes)
            .map_err(|error| error.to_string())?;
        if let Some(request_id) = deletion.request_id {
            if let Some(maintenance) = app.try_state::<crate::history_maintenance::HistoryMaintenance>() {
                maintenance.track_batch(request_id, estimated_bytes);
            }
        }
        Ok(deletion.deleted_ids)
    })
    .await
    .map_err(|error| format!("edit history bulk deletion task failed: {error}"))?
}

#[tauri::command]
pub async fn get_history_reclaim_status(app: AppHandle) -> Option<crate::history_maintenance::ReclaimStatus> {
    let maintenance = app.try_state::<crate::history_maintenance::HistoryMaintenance>()?;
    maintenance.status().await
}

fn prioritize_history_save(app: &AppHandle) -> Option<crate::history_maintenance::SaveGuard> {
    app.try_state::<crate::history_maintenance::HistoryMaintenance>()
        .map(|maintenance| maintenance.begin_save())
}

fn attach_saved_history(
    info: &mut PackageInfo,
    database: Result<PathBuf, String>,
    kind: &str,
    path: &Path,
    revision: &str,
) {
    let result = database.and_then(|database| {
        let document = saved_history::identity(kind, path).map_err(|error| error.to_string())?;
        saved_history::load(&database, &document, revision).map_err(|error| error.to_string())
    });
    match result {
        Ok(Some(loaded)) => {
            info.edit_history = Some(loaded.checkpoint);
            info.edit_history_download = loaded.download;
        }
        Ok(None) => {}
        Err(error) => info.edit_history_warning = Some(error),
    }
}

enum EitherAttachments {
    Inline(std::vec::IntoIter<String>),
    Uploaded(std::vec::IntoIter<Vec<u8>>),
}

impl Iterator for EitherAttachments {
    type Item = Result<Vec<u8>, saved_history::HistoryError>;

    fn next(&mut self) -> Option<Self::Item> {
        use base64::Engine as _;
        match self {
            Self::Inline(values) => values.next().map(|value| {
                base64::engine::general_purpose::STANDARD
                    .decode(value)
                    .map_err(Into::into)
            }),
            Self::Uploaded(values) => values.next().map(Ok),
        }
    }
}

struct HistoryWrite {
    database: Result<PathBuf, String>,
    checkpoint: Option<EditCheckpoint>,
    uploaded: Option<Vec<Vec<u8>>>,
    pending: Option<PendingCheckpoint>,
    warning: Option<String>,
}

impl HistoryWrite {
    fn new(
        database: Result<PathBuf, String>,
        checkpoint: Option<EditCheckpoint>,
        uploaded: Result<Option<Vec<Vec<u8>>>, String>,
    ) -> Self {
        let (uploaded, warning) = match uploaded {
            Ok(uploaded) => (uploaded, None),
            Err(error) => (None, Some(error)),
        };
        Self {
            database,
            checkpoint: checkpoint.filter(|_| warning.is_none()),
            uploaded,
            pending: None,
            warning,
        }
    }

    fn prepare(&mut self, kind: &str, path: &Path, revision: &str, recoverable: bool) {
        let Some(checkpoint) = self.checkpoint.take() else {
            return;
        };
        let result = self.database.clone().and_then(|database| {
            let document =
                saved_history::identity(kind, path).map_err(|error| error.to_string())?;
            let attachments = match self.uploaded.take() {
                Some(bytes) => EitherAttachments::Uploaded(bytes.into_iter()),
                None => EitherAttachments::Inline(checkpoint.attachments.into_iter()),
            };
            PendingCheckpoint::prepare(
                database,
                document,
                revision,
                recoverable,
                checkpoint.data,
                attachments,
            )
            .map_err(|error| error.to_string())
        });
        match result {
            Ok(pending) => self.pending = Some(pending),
            Err(error) => self.warning = Some(error),
        }
    }

    fn finish<T>(
        &mut self,
        result: Result<T, String>,
        revision: Option<&str>,
    ) -> Result<T, String> {
        if let Some(pending) = self.pending.take() {
            let history_result = match revision {
                Some(revision) if result.is_ok() => pending.complete(revision),
                _ => pending.discard(),
            };
            if let Err(error) = history_result {
                self.warning = Some(error.to_string());
            }
        }
        result
    }
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
        "version": "2.0",
        "entrypoint": "index.md",
        "title": "Untitled"
    }"#;
    let manifest = crate::manifest::Manifest::parse(manifest_json).map_err(|e| e.to_string())?;
    let files = vec![crate::package_file::PackageFile::new_text(
        "index.md".to_string(),
        "# Untitled".to_string(),
    )];
    let zip = write_package(&manifest, &files).map_err(|e| e.to_string())?;
    atomic_save(&PathBuf::from(&path), &zip).map_err(|e| e.to_string())?;
    Ok(())
}

/// フォルダから `.mdpkg` を作成する Tauri コマンド。
#[tauri::command]
pub fn import_folder(folder: String, dest: String) -> Result<(), String> {
    let loaded = crate::folder_document::load_folder(Path::new(&folder)).map_err(|e| e.to_string())?;
    let zip = write_package(&loaded.manifest, &loaded.files).map_err(|e| e.to_string())?;
    atomic_save(Path::new(&dest), &zip).map_err(|e| e.to_string())
}

/// `.mdpkg` をフォルダへ展開する Tauri コマンド。
#[tauri::command]
pub fn export_folder(package_path: String, dest: String) -> Result<(), String> {
    let data = read_file(Path::new(&package_path), MAX_DOCUMENT_BYTES).map_err(|e| e.to_string())?;
    let loaded = load_package(&data).map_err(|e| e.to_string())?;
    crate::folder_export::export(&loaded, Path::new(&dest))
}

/// AI 設定を保存する Tauri コマンド。
#[tauri::command]
pub fn save_ai_config(app: AppHandle, config: crate::ai::config::AiConfig) -> Result<(), String> {
    crate::ai::storage::save_ai_config(&ai_config_path(&app)?, &config)
}

/// AI 設定を読み込む Tauri コマンド。
#[tauri::command]
pub fn load_ai_config(app: AppHandle) -> Result<crate::ai::config::AiConfig, String> {
    crate::ai::storage::load_ai_config(&ai_config_path(&app)?)
}

#[tauri::command]
pub fn has_ai_configuration(app: AppHandle) -> Result<bool, String> {
    crate::ai::storage::has_ai_configuration(&ai_config_path(&app)?)
}

fn ai_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(crate::ai::storage::ai_config_path(&directory))
}

fn ai_settings_timeout(seconds: Option<u64>) -> Result<Duration, AiError> {
    let seconds = seconds.unwrap_or(crate::ai::streaming::DEFAULT_CONNECT_TIMEOUT_SECONDS);
    crate::ai::config::validate_timeout(seconds)
        .map_err(|error| AiError::InvalidConfiguration(error.to_string()))?;
    Ok(Duration::from_secs(seconds))
}

/// Model 一覧を取得する Tauri コマンド。
#[tauri::command]
pub async fn list_ai_models(
    base_url: String,
    api_key: Option<String>,
    connect_timeout_seconds: Option<u64>,
) -> Result<Vec<String>, AiError> {
    let timeout = ai_settings_timeout(connect_timeout_seconds)?;
    let provider = crate::ai::openai::OpenAiCompatibleProvider::new(&base_url, api_key.as_deref());
    provider.list_models(timeout).await
}

/// 接続テストを実行する Tauri コマンド。
#[tauri::command]
pub async fn test_ai_connection(
    base_url: String,
    api_key: Option<String>,
    model: String,
    connect_timeout_seconds: Option<u64>,
) -> Result<(), AiError> {
    let timeout = ai_settings_timeout(connect_timeout_seconds)?;
    let provider = crate::ai::openai::OpenAiCompatibleProvider::new(&base_url, api_key.as_deref());
    provider.test_connection(&model, timeout).await
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
) -> Result<String, AiError> {
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
) -> Result<String, AiError> {
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
) -> Result<String, AiError> {
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
    ).await
}

#[tauri::command]
pub async fn ai_edit_diagram(
    state: tauri::State<'_, crate::ai::commands::AiStreamState>,
    channel: tauri::ipc::Channel<crate::ai::types::AiStreamEvent>,
    base_url: String,
    api_key: Option<String>,
    model: String,
    format: crate::ai::prompt::DiagramFormat,
    current_source: String,
    instruction: String,
    connect_timeout_seconds: Option<u64>,
    request_timeout_seconds: Option<u64>,
) -> Result<String, AiError> {
    if instruction.trim().is_empty() {
        return Err(AiError::InvalidConfiguration("diagram edit instruction must not be empty".to_string()));
    }
    let request = crate::ai::prompt::build_diagram_edit_request(format, &current_source, &instruction);
    let provider = crate::ai::openai::OpenAiCompatibleProvider::new(&base_url, api_key.as_deref()).with_model(model);
    let coordinator = crate::ai::streaming::AiStreamCoordinator::with_registry(provider, state.registry.clone());
    crate::ai::commands::run_ai_stream(
        &coordinator,
        move |event| { let _ = channel.send(event); },
        request,
        connect_timeout_seconds,
        request_timeout_seconds,
    ).await
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
    use super::{import_folder, read_image_at};
    use super::{
        create_new_package, export_folder, export_package, read_imported_file, save_attachment_at,
        FileContent, SaveRequest,
    };
    use super::{
        open_folder_at, open_package_at, save_folder_at, save_package_at, FolderSaveRequest,
    };
    use crate::saved_history::{self, EditCheckpoint};
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
    fn invalid_saves_leave_the_existing_package_untouched() {
        let path = temporary_attachment_path().with_extension("mdpkg");
        std::fs::write(&path, b"existing bytes").unwrap();
        let valid = serde_json::json!({"format":"mdpkg","version":"2.0","entrypoint":"index.md"});
        let mut wrong_format = valid.clone();
        wrong_format["format"] = "other".into();
        let mut missing_entry = valid.clone();
        missing_entry["entrypoint"] = "missing.md".into();
        let mut outside_resource = valid.clone();
        outside_resource["resources"] = serde_json::json!([{"source":"../outside.puml","rendered":"diagram.svg","type":"plantuml"}]);
        for manifest in [wrong_format, missing_entry, outside_resource] {
            let result = save_package_at(SaveRequest {
                path: path.to_string_lossy().into_owned(), manifest,
                files: index_file("new"), edit_history: None,
            }, Err("unused".into()), Ok(None));
            assert!(result.is_err());
            assert_eq!(std::fs::read(&path).unwrap(), b"existing bytes");
        }
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn import_uses_folder_validation_and_does_not_copy_the_manifest_twice() {
        let dir = temporary_attachment_path();
        std::fs::create_dir(&dir).unwrap();
        let source = dir.join("source");
        crate::folder_document::create_empty_folder(&source).unwrap();
        let destination = dir.join("out.mdpkg");
        import_folder(source.to_string_lossy().into_owned(), destination.to_string_lossy().into_owned()).unwrap();
        let bytes = std::fs::read(&destination).unwrap();
        assert_eq!(crate::package_loader::load_package(&bytes).unwrap().files.len(), 1);
        std::fs::write(source.join("manifest.json"), r#"{"format":"other","version":"2.0","entrypoint":"index.md"}"#).unwrap();
        assert!(import_folder(source.to_string_lossy().into_owned(), destination.to_string_lossy().into_owned()).is_err());
        assert_eq!(std::fs::read(&destination).unwrap(), bytes);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn image_and_attachment_imports_reject_oversized_files_before_reading() {
        let path = temporary_attachment_path().with_extension("png");
        let file = std::fs::File::create(&path).unwrap();
        file.set_len(crate::bounded_io::MAX_FILE_BYTES + 1).unwrap();
        drop(file);
        assert!(read_image_at(path.to_string_lossy().into_owned()).unwrap_err().contains("size limit"));
        assert!(read_imported_file(&path).unwrap_err().contains("size limit"));
        std::fs::remove_file(path).unwrap();
    }

    fn checkpoint(text: &str) -> EditCheckpoint {
        EditCheckpoint {
            data: text.into(),
            attachments: vec!["AQID".into()],
        }
    }

    fn index_file(text: &str) -> Vec<FileContent> {
        vec![FileContent {
            path: "index.md".into(),
            is_text: true,
            content: Some(text.into()),
            base64: None,
        }]
    }

    #[test]
    fn package_reopens_with_the_saved_checkpoint_only_for_matching_bytes() {
        let temp = temporary_attachment_path();
        std::fs::create_dir(&temp).unwrap();
        let path = temp.join("document.mdpkg");
        let database = temp.join("history.sqlite3");
        let manifest = serde_json::json!({
            "format": "mdpkg", "version": "2.0", "entrypoint": "index.md", "title": "Document"
        });
        let request = |content, edit_history| SaveRequest {
            path: path.to_string_lossy().into_owned(),
            manifest: manifest.clone(),
            files: index_file(content),
            edit_history,
        };
        let saved = checkpoint("saved cursor");
        let outcome = save_package_at(
            request("saved", Some(saved.clone())),
            Ok(database.clone()),
            Ok(None),
        )
        .unwrap();
        assert!(outcome.edit_history_warning.is_none());
        let opened = open_package_at(&path, Ok(database.clone())).unwrap();
        assert_eq!(opened.edit_history, Some(saved));
        assert_eq!(opened.files[0].content.as_deref(), Some("saved"));

        // The document remains usable when a subsequent history write fails.
        let invalid = EditCheckpoint {
            data: "new cursor".into(),
            attachments: vec!["!".into()],
        };
        let outcome = save_package_at(
            request("changed externally", Some(invalid)),
            Ok(database.clone()),
            Ok(None),
        )
        .unwrap();
        assert!(outcome.edit_history_warning.is_some());
        let opened = open_package_at(&path, Ok(database)).unwrap();
        assert_eq!(
            opened.files[0].content.as_deref(),
            Some("changed externally")
        );
        assert!(opened.edit_history.is_none());
        std::fs::remove_dir_all(temp).unwrap();
    }

    #[test]
    fn folder_reopens_with_the_last_saved_checkpoint_after_a_failed_save() {
        let temp = temporary_attachment_path();
        std::fs::create_dir(&temp).unwrap();
        let path = temp.join("document");
        let database = temp.join("history.sqlite3");
        std::fs::create_dir(&path).unwrap();
        std::fs::write(path.join("index.md"), "# Original").unwrap();
        let initial = open_folder_at(&path, Some(Ok(database.clone()))).unwrap();
        let initial_revision = initial.folder_revision.unwrap();
        let request = |expected_revision: String, content, edit_history| FolderSaveRequest {
            path: path.to_string_lossy().into_owned(),
            manifest: initial.manifest.clone(),
            files: index_file(content),
            edit_history: Some(edit_history),
            original_paths: vec!["index.md".into()],
            expected_revision,
        };
        let saved = checkpoint("saved cursor");
        let outcome = save_folder_at(
            request(initial_revision.clone(), "# Saved", saved.clone()),
            Ok(database.clone()),
            Ok(None),
        )
        .unwrap();
        assert!(outcome.edit_history_warning.is_none());
        let failed = save_folder_at(
            request(initial_revision, "# Not saved", checkpoint("failed cursor")),
            Ok(database.clone()),
            Ok(None),
        );
        assert!(failed.is_err());
        let opened = open_folder_at(&path, Some(Ok(database.clone()))).unwrap();
        assert_eq!(opened.edit_history, Some(saved));
        assert_eq!(opened.files[0].content.as_deref(), Some("# Saved"));
        assert!(open_folder_at(&path, None).unwrap().edit_history.is_none());

        let document = saved_history::identity("folder", &path).unwrap();
        saved_history::clear(&database, &document).unwrap();
        let opened = open_folder_at(&path, Some(Ok(database))).unwrap();
        assert!(opened.edit_history.is_none());
        assert_eq!(opened.files[0].content.as_deref(), Some("# Saved"));
        std::fs::remove_dir_all(temp).unwrap();
    }

    #[test]
    fn creates_a_v2_package_with_index_entrypoint() {
        let path = temporary_attachment_path().with_extension("mdpkg");
        create_new_package(path.to_string_lossy().into_owned()).unwrap();
        let loaded = crate::package_loader::load_package(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(loaded.manifest.version, "2.0");
        assert_eq!(loaded.manifest.entrypoint, "index.md");
        assert!(loaded.files.iter().any(|file| file.path == "index.md"));
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn reads_an_arbitrary_attachment_as_base64() {
        let path = temporary_attachment_path();
        std::fs::write(&path, [1_u8, 2, 3]).unwrap();

        let imported = read_imported_file(&path).unwrap();

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

        save_attachment_at(path.to_string_lossy().into_owned(), "AQID".to_string()).unwrap();

        assert_eq!(std::fs::read(&path).unwrap(), [1_u8, 2, 3]);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn exports_a_valid_document_as_mdpkg() {
        let path = temporary_attachment_path().with_extension("mdpkg");
        let request = SaveRequest {
            edit_history: None,
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
            edit_history: None,
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
