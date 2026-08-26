use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use crate::atomic_save::atomic_save;
use crate::manifest::Manifest;
use crate::package_file::PackageFile;
use crate::package_validation::{validate_entrypoint_exists, validate_manifest, validate_paths};
use crate::path_validator::validate_package_path;

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
}

pub struct FolderDocument {
    pub root: PathBuf,
    pub manifest: Manifest,
    pub files: Vec<PackageFile>,
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
    reject_link(path)?;
    let root = fs::canonicalize(path)?;
    if !root.is_dir() {
        return Err(FolderError::Invalid("selected path is not a folder".into()));
    }
    let manifest_path = root.join("manifest.json");
    if !manifest_path.is_file() {
        return Err(FolderError::MissingManifest);
    }
    reject_link(&manifest_path)?;
    let manifest_text = fs::read_to_string(&manifest_path)
        .map_err(|e| FolderError::Invalid(format!("manifest.json cannot be read: {e}")))?;
    let manifest =
        Manifest::parse(&manifest_text).map_err(|e| FolderError::Invalid(e.to_string()))?;
    validate_manifest(&manifest).map_err(|e| FolderError::Invalid(e.to_string()))?;
    validate_paths(&manifest).map_err(|e| FolderError::Invalid(e.to_string()))?;

    let mut files = Vec::new();
    collect(&root, &root, &mut files)?;
    let paths = files.iter().map(|f| f.path.clone()).collect::<Vec<_>>();
    validate_entrypoint_exists(&manifest, &paths)
        .map_err(|e| FolderError::Invalid(e.to_string()))?;
    Ok(FolderDocument {
        root,
        manifest,
        files,
    })
}

fn collect(root: &Path, dir: &Path, files: &mut Vec<PackageFile>) -> Result<(), FolderError> {
    reject_link(dir)?;
    ensure_inside(root, dir)?;
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        reject_link(&path)?;
        ensure_inside(root, &path)?;
        if entry.file_type()?.is_dir() {
            collect(root, &path, files)?;
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

pub fn save_folder(
    path: &Path,
    manifest: &Manifest,
    files: &[PackageFile],
    original: &[String],
) -> Result<(), FolderError> {
    let loaded = load_folder(path)?;
    let root = loaded.root;
    validate_document(manifest, files)?;
    let next = files
        .iter()
        .map(|f| f.path.replace('\\', "/"))
        .collect::<HashSet<_>>();
    for old in original {
        let old = old.replace('\\', "/");
        validate_package_path(&old).map_err(|_| FolderError::Outside(old.clone()))?;
        if old == "manifest.json" || next.contains(&old) {
            continue;
        }
        let target = safe_target(&root, &old, false)?;
        if target.exists() {
            reject_link(&target)?;
            fs::remove_file(target)?;
        }
    }
    for file in files {
        let rel = file.path.replace('\\', "/");
        let target = safe_target(&root, &rel, true)?;
        atomic_save(&target, &file.content).map_err(|e| FolderError::Invalid(e.to_string()))?;
    }
    let manifest_json =
        serde_json::to_vec_pretty(manifest).map_err(|e| FolderError::Invalid(e.to_string()))?;
    atomic_save(&root.join("manifest.json"), &manifest_json)
        .map_err(|e| FolderError::Invalid(e.to_string()))?;
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

fn safe_target(root: &Path, rel: &str, create_parents: bool) -> Result<PathBuf, FolderError> {
    validate_package_path(rel).map_err(|_| FolderError::Outside(rel.into()))?;
    let target = root.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR));
    let parent = target
        .parent()
        .ok_or_else(|| FolderError::Outside(rel.into()))?;
    if create_parents {
        create_safe_parents(root, parent)?;
    }
    reject_chain(root, parent)?;
    if target.exists() {
        reject_link(&target)?;
        ensure_inside(root, &target)?;
    }
    Ok(target)
}

fn create_safe_parents(root: &Path, parent: &Path) -> Result<(), FolderError> {
    let rel = parent
        .strip_prefix(root)
        .map_err(|_| FolderError::Outside(parent.display().to_string()))?;
    let mut current = root.to_path_buf();
    for part in rel.components() {
        current.push(part);
        if current.exists() {
            reject_link(&current)?;
            ensure_inside(root, &current)?;
        } else {
            fs::create_dir(&current)?;
        }
    }
    Ok(())
}

fn reject_chain(root: &Path, path: &Path) -> Result<(), FolderError> {
    let mut current = PathBuf::from(root);
    let rel = path
        .strip_prefix(root)
        .map_err(|_| FolderError::Outside(path.display().to_string()))?;
    for part in rel.components() {
        current.push(part);
        reject_link(&current)?;
    }
    ensure_inside(root, path)
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
    fn rejects_missing_and_invalid_manifest() {
        let missing = temp("missing-manifest");
        assert!(matches!(
            load_folder(&missing),
            Err(FolderError::MissingManifest)
        ));
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
        save_folder(
            &dir,
            &loaded.manifest,
            &files,
            &["README.md".into(), "old.txt".into()],
        )
        .unwrap();
        assert_eq!(
            fs::read_to_string(dir.join("README.md")).unwrap(),
            "# Updated"
        );
        assert!(!dir.join("old.txt").exists());
        assert_eq!(fs::read_to_string(dir.join("renamed.txt")).unwrap(), "new");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn rejects_paths_outside_folder() {
        let dir = valid_folder("outside");
        let loaded = load_folder(&dir).unwrap();
        let files = vec![PackageFile::new_text("../outside.txt".into(), "bad".into())];
        assert!(save_folder(&dir, &loaded.manifest, &files, &[]).is_err());
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
