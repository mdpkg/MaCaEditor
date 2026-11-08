use std::fs;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::atomic_save::atomic_save;
use crate::manifest::Manifest;
use crate::package_file::PackageFile;
use crate::package_validation::{validate_entrypoint_exists, validate_manifest, validate_paths};
use crate::path_validator::validate_package_path;

mod save;
pub use save::{save_folder, save_folder_with_checkpoint};
const SAVE_DIRECTORY: &str = ".maca-save";

#[derive(Debug, thiserror::Error)]
pub enum FolderError {
    #[error("manifest.json is missing")]
    MissingManifest,
    #[error("invalid folder document: {0}")]
    Invalid(String),
    #[error("symbolic links and junctions are not allowed: {0}")]
    Link(String),
    #[error("path escapes the working folder: {0}")]
    Outside(String),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("folder changed on disk")]
    Conflict,
    #[error("folder save requires recovery at {path}: {1}", path = .0.display())]
    Recovery(PathBuf, String),
}

pub struct FolderDocument {
    pub root: PathBuf,
    pub manifest: Manifest,
    pub files: Vec<PackageFile>,
    pub manifest_was_generated: bool,
    pub revision: String,
    manifest_bytes: Option<Vec<u8>>,
}

pub fn create_empty_folder(path: &Path) -> Result<FolderDocument, FolderError> {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| FolderError::Invalid("folder name is invalid".into()))?;
    validate_folder_name(name)?;
    let parent = path
        .parent()
        .ok_or_else(|| FolderError::Invalid("folder must have a parent".into()))?;
    reject_link(parent)?;
    let parent = fs::canonicalize(parent)?;
    if !parent.is_dir() {
        return Err(FolderError::Invalid(
            "selected parent is not a folder".into(),
        ));
    }
    let root = parent.join(name);
    if root.exists() {
        return Err(FolderError::Invalid(format!(
            "folder already exists: {name}"
        )));
    }
    fs::create_dir(&root)?;
    let result = (|| {
        let manifest = Manifest::parse(
            r#"{"format":"mdpkg","version":"2.0","entrypoint":"index.md","title":"Untitled"}"#,
        )
        .map_err(|e| FolderError::Invalid(e.to_string()))?;
        let manifest_json = serde_json::to_vec_pretty(&manifest)
            .map_err(|e| FolderError::Invalid(e.to_string()))?;
        atomic_save(&root.join("manifest.json"), &manifest_json)
            .map_err(|e| FolderError::Invalid(e.to_string()))?;
        atomic_save(&root.join("index.md"), b"# Untitled\n")
            .map_err(|e| FolderError::Invalid(e.to_string()))?;
        load_folder(&root)
    })();
    if result.is_err() {
        let _ = fs::remove_file(root.join("manifest.json"));
        let _ = fs::remove_file(root.join("index.md"));
        let _ = fs::remove_dir(&root);
    }
    result
}

fn validate_folder_name(name: &str) -> Result<(), FolderError> {
    if name.trim() != name
        || name.is_empty()
        || name == "."
        || name == ".."
        || name.contains('/')
        || name.contains('\\')
        || name
            .chars()
            .any(|c| c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*'))
    {
        return Err(FolderError::Invalid("folder name is invalid".into()));
    }
    Ok(())
}

pub fn load_folder(path: &Path) -> Result<FolderDocument, FolderError> {
    load_folder_inner(path, false)
}

fn load_folder_inner(path: &Path, own_save_directory: bool) -> Result<FolderDocument, FolderError> {
    reject_link(path)?;
    let root = fs::canonicalize(path)?;
    if !root.is_dir() {
        return Err(FolderError::Invalid("selected path is not a folder".into()));
    }
    let save_path = root.join(SAVE_DIRECTORY);
    if !own_save_directory {
        match fs::symlink_metadata(&save_path) {
            Ok(_) => {
                return Err(FolderError::Recovery(
                    save_path,
                    "backup data is still present".into(),
                ))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    let manifest_path = root.join("manifest.json");
    let manifest_bytes = if manifest_path.is_file() {
        reject_link(&manifest_path)?;
        Some(fs::read(&manifest_path)?)
    } else {
        None
    };
    let mut files = Vec::new();
    collect(
        &root,
        &root,
        &mut files,
        manifest_bytes.is_none(),
        &save_path,
    )?;
    let (manifest, manifest_was_generated) = if let Some(bytes) = &manifest_bytes {
        let manifest_text = std::str::from_utf8(bytes)
            .map_err(|e| FolderError::Invalid(format!("manifest.json cannot be read: {e}")))?;
        (
            Manifest::parse(manifest_text).map_err(|e| FolderError::Invalid(e.to_string()))?,
            false,
        )
    } else {
        let mut markdown_paths = files
            .iter()
            .filter(|file| {
                file.is_text()
                    && (file.path.to_ascii_lowercase().ends_with(".md")
                        || file.path.to_ascii_lowercase().ends_with(".markdown"))
            })
            .map(|file| file.path.clone())
            .collect::<Vec<_>>();
        markdown_paths.sort();
        let entrypoint = markdown_paths
            .iter()
            .find(|path| path.as_str() == "index.md")
            .or_else(|| {
                markdown_paths
                    .iter()
                    .find(|path| path.as_str() == "README.md")
            })
            .or_else(|| markdown_paths.first())
            .ok_or(FolderError::MissingManifest)?;
        let json = serde_json::json!({
            "format": "mdpkg", "version": "2.0", "entrypoint": entrypoint
        });
        (
            Manifest::parse(&json.to_string()).map_err(|e| FolderError::Invalid(e.to_string()))?,
            true,
        )
    };
    validate_manifest(&manifest).map_err(|e| FolderError::Invalid(e.to_string()))?;
    validate_paths(&manifest).map_err(|e| FolderError::Invalid(e.to_string()))?;
    let paths = files.iter().map(|f| f.path.clone()).collect::<Vec<_>>();
    validate_entrypoint_exists(&manifest, &paths)
        .map_err(|e| FolderError::Invalid(e.to_string()))?;
    Ok(FolderDocument {
        root,
        manifest,
        revision: folder_revision(
            manifest_bytes.as_deref(),
            files
                .iter()
                .map(|file| (file.path.as_str(), file.content.as_slice())),
        ),
        files,
        manifest_was_generated,
        manifest_bytes,
    })
}

fn folder_revision<'a>(
    manifest: Option<&[u8]>,
    files: impl IntoIterator<Item = (&'a str, &'a [u8])>,
) -> String {
    let mut files: Vec<_> = files.into_iter().collect();
    files.sort_unstable_by(|left, right| left.0.cmp(right.0));
    let mut digest = Sha256::new();
    digest.update([u8::from(manifest.is_some())]);
    let mut field = |bytes: &[u8]| {
        digest.update((bytes.len() as u64).to_le_bytes());
        digest.update(bytes);
    };
    if let Some(manifest) = manifest {
        field(manifest);
    }
    for (path, bytes) in files {
        field(path.as_bytes());
        field(bytes);
    }
    format!("{:x}", digest.finalize())
}

fn ignored_inference_directory(path: &Path) -> bool {
    matches!(
        path.file_name().and_then(|name| name.to_str()),
        Some(
            ".git"
                | ".hg"
                | ".svn"
                | ".next"
                | "node_modules"
                | "target"
                | "dist"
                | "build"
                | "coverage"
        )
    )
}

fn collect(
    root: &Path,
    dir: &Path,
    files: &mut Vec<PackageFile>,
    ignore_generated_directories: bool,
    save_path: &Path,
) -> Result<(), FolderError> {
    reject_link(dir)?;
    ensure_inside(root, dir)?;
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path == save_path {
            continue;
        }
        reject_link(&path)?;
        ensure_inside(root, &path)?;
        if entry.file_type()?.is_dir() {
            if ignore_generated_directories && ignored_inference_directory(&path) {
                continue;
            }
            collect(root, &path, files, ignore_generated_directories, save_path)?;
        } else if entry.file_type()?.is_file() {
            let rel = path
                .strip_prefix(root)
                .map_err(|_| FolderError::Outside(path.display().to_string()))?;
            let rel = rel.to_string_lossy().replace('\\', "/");
            validate_package_path(&rel).map_err(|_| FolderError::Outside(rel.clone()))?;
            if rel == "manifest.json" {
                continue;
            }
            let bytes = fs::read(&path)?;
            let file = if crate::package_loader::is_text_path(&rel) {
                match String::from_utf8(bytes.clone()) {
                    Ok(text) => PackageFile::new_text(rel, text),
                    Err(_) => PackageFile::new_binary(rel, bytes),
                }
            } else {
                PackageFile::new_binary(rel, bytes)
            };
            files.push(file);
        }
    }
    Ok(())
}

pub fn validate_document(manifest: &Manifest, files: &[PackageFile]) -> Result<(), FolderError> {
    validate_manifest(manifest).map_err(|e| FolderError::Invalid(e.to_string()))?;
    validate_paths(manifest).map_err(|e| FolderError::Invalid(e.to_string()))?;
    for file in files {
        validate_package_path(&file.path).map_err(|_| FolderError::Outside(file.path.clone()))?;
    }
    let paths = files.iter().map(|f| f.path.clone()).collect::<Vec<_>>();
    validate_entrypoint_exists(manifest, &paths)
        .map_err(|e| FolderError::Invalid(e.to_string()))?;
    Ok(())
}

fn ensure_inside(root: &Path, path: &Path) -> Result<(), FolderError> {
    let canonical = fs::canonicalize(path)?;
    if canonical.starts_with(root) {
        Ok(())
    } else {
        Err(FolderError::Outside(path.display().to_string()))
    }
}

fn reject_link(path: &Path) -> Result<(), FolderError> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() {
        Err(FolderError::Link(path.display().to_string()))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "maca-folder-{}-{name}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn valid_folder(name: &str) -> PathBuf {
        let dir = temp(name);
        fs::write(
            dir.join("manifest.json"),
            r#"{"format":"mdpkg","version":"1.0","entrypoint":"README.md","title":"T"}"#,
        )
        .unwrap();
        fs::write(dir.join("README.md"), "# Hello").unwrap();
        dir
    }

    #[test]
    fn loads_text_and_binary_files() {
        let dir = valid_folder("load");
        fs::create_dir(dir.join("images")).unwrap();
        fs::write(dir.join("images/a.png"), [0x89, 0x50]).unwrap();
        let loaded = load_folder(&dir).unwrap();
        assert_eq!(loaded.manifest.format, "mdpkg");
        assert!(loaded
            .files
            .iter()
            .any(|f| f.path == "README.md" && f.is_text()));
        assert!(loaded
            .files
            .iter()
            .any(|f| f.path == "images/a.png" && !f.is_text()));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn loads_a_markdown_folder_without_manifest_using_a_generated_v2_manifest() {
        let missing = temp("missing-manifest");
        fs::write(missing.join("README.md"), "# Read me").unwrap();
        fs::write(missing.join("index.md"), "# Index").unwrap();
        let loaded = load_folder(&missing).unwrap();
        assert!(loaded.manifest_was_generated);
        assert_eq!(loaded.manifest.version, "2.0");
        assert_eq!(loaded.manifest.entrypoint, "index.md");
        fs::remove_dir_all(missing).unwrap();
    }

    #[test]
    fn skips_generated_dependency_directories_when_inferring_a_manifest() {
        let dir = temp("manifest-inference-ignored-directories");
        fs::write(dir.join("index.md"), "# Index").unwrap();
        fs::create_dir_all(dir.join("node_modules/dependency")).unwrap();
        fs::write(
            dir.join("node_modules/dependency/README.md"),
            "# Dependency",
        )
        .unwrap();
        fs::create_dir_all(dir.join("target/debug")).unwrap();
        fs::write(dir.join("target/debug/output.bin"), [0_u8; 64]).unwrap();

        let loaded = load_folder(&dir).unwrap();

        assert_eq!(loaded.files.len(), 1);
        assert_eq!(loaded.files[0].path, "index.md");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn rejects_manifestless_folders_without_markdown_and_invalid_manifests() {
        let missing = temp("missing-manifest-and-markdown");
        assert!(load_folder(&missing).is_err());
        fs::remove_dir_all(missing).unwrap();
        let invalid = temp("invalid-manifest");
        fs::write(invalid.join("manifest.json"), "not json").unwrap();
        assert!(load_folder(&invalid).is_err());
        fs::remove_dir_all(invalid).unwrap();
    }

    #[test]
    fn rejects_missing_entrypoint() {
        let dir = temp("missing-entrypoint");
        fs::write(
            dir.join("manifest.json"),
            r#"{"format":"mdpkg","version":"1.0","entrypoint":"missing.md","title":"T"}"#,
        )
        .unwrap();
        assert!(load_folder(&dir).is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn creates_a_new_valid_folder_document() {
        let parent = temp("create-empty");
        let created = create_empty_folder(&parent.join("my-document")).unwrap();
        assert_eq!(
            created.root,
            fs::canonicalize(parent.join("my-document")).unwrap()
        );
        assert_eq!(created.manifest.version, "2.0");
        assert_eq!(created.manifest.entrypoint, "index.md");
        assert_eq!(
            fs::read_to_string(created.root.join("index.md")).unwrap(),
            "# Untitled\n"
        );
        assert!(created.root.join("manifest.json").is_file());
        fs::remove_dir_all(parent).unwrap();
    }

    #[test]
    fn empty_folder_creation_rejects_unsafe_or_existing_names() {
        let parent = temp("create-invalid");
        fs::create_dir(parent.join("existing-empty")).unwrap();
        assert!(create_empty_folder(&parent.join("existing-empty")).is_err());
        assert!(create_empty_folder(&parent.join("bad:name")).is_err());
        fs::remove_dir_all(parent).unwrap();
    }

    #[test]
    fn saves_changes_additions_deletions_and_renames() {
        let dir = valid_folder("save");
        fs::write(dir.join("old.txt"), "old").unwrap();
        let loaded = load_folder(&dir).unwrap();
        let mut files = loaded.files;
        files.retain(|f| f.path != "old.txt" && f.path != "README.md");
        files.push(PackageFile::new_text(
            "README.md".into(),
            "# Updated".into(),
        ));
        files.push(PackageFile::new_text("renamed.txt".into(), "new".into()));
        let revision = save_folder(
            &dir,
            &loaded.manifest,
            &files,
            &["README.md".into(), "old.txt".into()],
            &loaded.revision,
        )
        .unwrap();
        assert_eq!(
            fs::read_to_string(dir.join("README.md")).unwrap(),
            "# Updated"
        );
        assert!(!dir.join("old.txt").exists());
        assert_eq!(fs::read_to_string(dir.join("renamed.txt")).unwrap(), "new");
        assert_eq!(load_folder(&dir).unwrap().revision, revision);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn failed_folder_save_preserves_original_files_and_manifest() {
        let dir = valid_folder("failed-save");
        fs::write(dir.join("old.txt"), b"original attachment").unwrap();
        fs::write(dir.join("blocker"), b"original file").unwrap();
        let original_manifest = fs::read(dir.join("manifest.json")).unwrap();
        let loaded = load_folder(&dir).unwrap();
        let files = [
            PackageFile::new_text("README.md".into(), "new link".into()),
            PackageFile::new_text("blocker/guide.md".into(), "new file".into()),
        ];

        assert!(save_folder(
            &dir,
            &loaded.manifest,
            &files,
            &["old.txt".into()],
            &loaded.revision
        )
        .is_err());
        assert_eq!(
            fs::read(dir.join("old.txt")).unwrap(),
            b"original attachment"
        );
        assert_eq!(fs::read(dir.join("README.md")).unwrap(), b"# Hello");
        assert_eq!(fs::read(dir.join("blocker")).unwrap(), b"original file");
        assert_eq!(
            fs::read(dir.join("manifest.json")).unwrap(),
            original_manifest
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn restores_overwrites_and_deletions_when_manifest_publication_fails() {
        let dir = valid_folder("rollback");
        let manifest_before = fs::read(dir.join("manifest.json")).unwrap();
        fs::write(dir.join("old.bin"), [0, 0xff]).unwrap();
        let loaded = load_folder(&dir).unwrap();
        let files = [
            PackageFile::new_text("README.md".into(), "[Moved](new/moved.bin)".into()),
            PackageFile::new_binary("new/moved.bin".into(), vec![0, 0xff]),
        ];
        let original = ["README.md".into(), "old.bin".into()];
        let mut failed_after_publish = false;
        let result = save::save_folder_with(
            &dir,
            &loaded.manifest,
            &files,
            &original,
            &loaded.revision,
            |target| {
                if target.ends_with("manifest.json") {
                    let root = target.parent().unwrap();
                    assert!(root.join("new/moved.bin").is_file());
                    assert!(!root.join("old.bin").exists());
                    assert_ne!(fs::read(root.join("README.md")).unwrap(), b"# Hello");
                    failed_after_publish = true;
                    return Err(std::io::Error::other(
                        "injected manifest publication failure",
                    ));
                }
                Ok(())
            },
            |_| {},
        );
        assert!(matches!(result, Err(FolderError::Io(_))));
        assert!(failed_after_publish);
        assert_eq!(fs::read(dir.join("README.md")).unwrap(), b"# Hello");
        assert_eq!(fs::read(dir.join("old.bin")).unwrap(), [0, 0xff]);
        assert_eq!(
            fs::read(dir.join("manifest.json")).unwrap(),
            manifest_before
        );
        assert!(!dir.join("new").exists());
        assert!(!dir.join(SAVE_DIRECTORY).exists());
        assert_eq!(load_folder(&dir).unwrap().revision, loaded.revision);
        assert!(save_folder(&dir, &loaded.manifest, &files, &original, &loaded.revision).is_ok());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn preserves_backups_and_blocks_saves_when_an_external_file_prevents_rollback() {
        let dir = valid_folder("recovery");
        let loaded = load_folder(&dir).unwrap();
        let files = [PackageFile::new_text("README.md".into(), "New".into())];
        let original = ["README.md".into()];
        let result = save::save_folder_with(
            &dir,
            &loaded.manifest,
            &files,
            &original,
            &loaded.revision,
            |target| {
                if target.ends_with("manifest.json") {
                    fs::write(target.parent().unwrap().join("README.md"), b"External")?;
                    return Err(std::io::Error::other("injected failure with external edit"));
                }
                Ok(())
            },
            |_| {},
        );
        assert!(matches!(result, Err(FolderError::Recovery(..))));
        assert_eq!(fs::read(dir.join("README.md")).unwrap(), b"External");
        assert_eq!(
            fs::read(dir.join(SAVE_DIRECTORY).join("backup/README.md")).unwrap(),
            b"# Hello"
        );
        assert!(matches!(
            save_folder(&dir, &loaded.manifest, &files, &original, &loaded.revision),
            Err(FolderError::Recovery(..))
        ));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn first_manifest_save_returns_a_revision_that_includes_preexisting_files() {
        let dir = temp("first-save");
        fs::write(dir.join("index.md"), b"# Index").unwrap();
        fs::create_dir(dir.join("build")).unwrap();
        fs::write(dir.join("build/previous.bin"), b"untouched").unwrap();
        let loaded = load_folder(&dir).unwrap();
        assert_eq!(loaded.files.len(), 1);
        let revision = save_folder(
            &dir,
            &loaded.manifest,
            &loaded.files,
            &["index.md".into()],
            &loaded.revision,
        )
        .unwrap();
        let reopened = load_folder(&dir).unwrap();
        assert_eq!(reopened.revision, revision);
        assert_eq!(
            fs::read(dir.join("build/previous.bin")).unwrap(),
            b"untouched"
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn saves_a_file_and_directory_trading_places() {
        let dir = valid_folder("shape-change");
        fs::create_dir_all(dir.join("asset/nested")).unwrap();
        fs::write(dir.join("asset/nested/old.bin"), [42]).unwrap();
        let loaded = load_folder(&dir).unwrap();
        let files = [
            PackageFile::new_text("README.md".into(), "# Hello".into()),
            PackageFile::new_binary("asset".into(), vec![42]),
        ];
        let revision = save_folder(
            &dir,
            &loaded.manifest,
            &files,
            &["README.md".into(), "asset/nested/old.bin".into()],
            &loaded.revision,
        )
        .unwrap();
        assert_eq!(fs::read(dir.join("asset")).unwrap(), [42]);
        save_folder(
            &dir,
            &loaded.manifest,
            &loaded.files,
            &["README.md".into(), "asset".into()],
            &revision,
        )
        .unwrap();
        assert_eq!(fs::read(dir.join("asset/nested/old.bin")).unwrap(), [42]);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn rejects_a_stale_disk_revision_before_deleting_or_overwriting() {
        let dir = valid_folder("external");
        fs::write(dir.join("old.bin"), b"old").unwrap();
        let loaded = load_folder(&dir).unwrap();
        fs::write(dir.join("README.md"), b"External").unwrap();
        let files = [PackageFile::new_text("README.md".into(), "Local".into())];
        assert!(matches!(
            save_folder(
                &dir,
                &loaded.manifest,
                &files,
                &["README.md".into(), "old.bin".into()],
                &loaded.revision
            ),
            Err(FolderError::Conflict)
        ));
        assert_eq!(fs::read(dir.join("README.md")).unwrap(), b"External");
        assert_eq!(fs::read(dir.join("old.bin")).unwrap(), b"old");
        assert!(!dir.join(SAVE_DIRECTORY).exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn rejects_paths_outside_folder() {
        let dir = valid_folder("outside");
        let loaded = load_folder(&dir).unwrap();
        let files = vec![PackageFile::new_text("../outside.txt".into(), "bad".into())];
        assert!(save_folder(&dir, &loaded.manifest, &files, &[], &loaded.revision).is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinks_leaving_folder() {
        use std::os::unix::fs::symlink;
        let dir = valid_folder("symlink");
        symlink(std::env::temp_dir(), dir.join("linked")).unwrap();
        assert!(matches!(load_folder(&dir), Err(FolderError::Link(_))));
        fs::remove_file(dir.join("linked")).unwrap();
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn rejects_directory_symlinks_or_junctions() {
        use std::os::windows::fs::symlink_dir;
        let dir = valid_folder("symlink");
        if symlink_dir(std::env::temp_dir(), dir.join("linked")).is_ok() {
            assert!(matches!(load_folder(&dir), Err(FolderError::Link(_))));
            fs::remove_dir(dir.join("linked")).unwrap();
        }
        fs::remove_dir_all(dir).unwrap();
    }
}
