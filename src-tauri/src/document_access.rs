//! Custom commands must enforce native selection grants themselves. Frontend
//! recent paths are hints, not grants. Remember only already-approved documents
//! in Rust-owned application data so they can be reopened after restart.
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use tauri::{Manager, Window};
use tauri_plugin_fs::FsExt;

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct Approval {
    path: PathBuf,
    directory: bool,
}

#[derive(Default, serde::Serialize, serde::Deserialize)]
struct Approvals {
    documents: Vec<Approval>,
}

pub struct DocumentAccess {
    file: PathBuf,
    private_roots: Vec<PathBuf>,
    approvals: Mutex<Approvals>,
}

impl DocumentAccess {
    pub fn load(file: PathBuf) -> Self {
        let approvals = crate::bounded_io::read_file(&file, 1024 * 1024)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Approvals>(&bytes).ok())
            .filter(|value| value.documents.len() <= 128)
            .unwrap_or_default();
        Self {
            private_roots: vec![canonical_candidate(file.parent().unwrap())
                .unwrap_or_else(|_| file.parent().unwrap().to_path_buf())],
            file,
            approvals: Mutex::new(approvals),
        }
    }

    pub fn with_private_roots(mut self, roots: Vec<PathBuf>) -> Self {
        self.private_roots.extend(
            roots
                .into_iter()
                .filter_map(|path| canonical_candidate(&path).ok()),
        );
        self
    }

    fn deny_private(&self, path: &Path, directory: bool) -> Result<(), String> {
        let path = canonical_candidate(path)?;
        if self
            .private_roots
            .iter()
            .any(|root| path.starts_with(root) || (directory && root.starts_with(&path)))
        {
            return Err("application data cannot be accessed through document commands".into());
        }
        Ok(())
    }

    fn authorize(&self, path: &Path, directory: bool, selected: bool) -> Result<(), String> {
        validate_absolute_path(path)?;
        self.deny_private(path, directory)?;
        let canonical = std::fs::canonicalize(path).ok();
        let mut approvals = self
            .approvals
            .lock()
            .map_err(|_| "document approvals lock poisoned")?;
        let remembered = canonical.as_ref().is_some_and(|canonical| {
            approvals
                .documents
                .iter()
                .any(|entry| entry.directory == directory && entry.path == *canonical)
        });
        if !selected && !remembered {
            return Err(selection_error());
        }
        if selected {
            if let Some(canonical) = canonical.filter(|path| path.is_dir() == directory) {
                approvals
                    .documents
                    .retain(|entry| entry.path != canonical || entry.directory != directory);
                approvals.documents.push(Approval {
                    path: canonical,
                    directory,
                });
                if approvals.documents.len() > 128 {
                    approvals.documents.remove(0);
                }
                // Failure to remember must never expand permission. The current
                // selection still works; a later session requires re-selection.
                if let Err(error) = self.persist(&approvals) {
                    eprintln!("could not remember document approval: {error}");
                }
            }
        }
        Ok(())
    }

    fn persist(&self, approvals: &Approvals) -> Result<(), String> {
        let parent = self.file.parent().ok_or("invalid approvals path")?;
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        let bytes = serde_json::to_vec(approvals).map_err(|error| error.to_string())?;
        crate::atomic_save::atomic_save(&self.file, &bytes).map_err(|error| error.to_string())
    }
}

fn selection_error() -> String {
    "file access requires selecting or dropping the file first".into()
}

fn canonical_candidate(path: &Path) -> Result<PathBuf, String> {
    let mut ancestor = path;
    let mut missing = Vec::new();
    loop {
        if let Ok(mut resolved) = std::fs::canonicalize(ancestor) {
            for name in missing.into_iter().rev() {
                resolved.push(name);
            }
            return Ok(resolved);
        }
        missing.push(
            ancestor
                .file_name()
                .ok_or_else(selection_error)?
                .to_os_string(),
        );
        ancestor = ancestor.parent().ok_or_else(selection_error)?;
    }
}

fn validate_absolute_path(path: &Path) -> Result<(), String> {
    if !path.is_absolute() {
        return Err(selection_error());
    }
    for component in path.components() {
        match component {
            Component::ParentDir => return Err(selection_error()),
            Component::Normal(name) => {
                crate::path_validator::validate_package_path(&name.to_string_lossy())
                    .map_err(|_| selection_error())?
            }
            #[cfg(windows)]
            Component::Prefix(prefix)
                if matches!(prefix.kind(), std::path::Prefix::DeviceNS(_)) =>
            {
                return Err(selection_error())
            }
            _ => {}
        }
    }
    Ok(())
}

pub fn require_selected(window: &Window, path: &Path) -> Result<(), String> {
    validate_absolute_path(path)?;
    window
        .state::<DocumentAccess>()
        .deny_private(path, path.is_dir())?;
    if !window.fs_scope().is_allowed(path) {
        return Err(selection_error());
    }
    Ok(())
}

pub fn require_document(window: &Window, path: &Path, directory: bool) -> Result<(), String> {
    // Forbidden paths take precedence even over remembered native selections.
    let scope = window.fs_scope();
    if scope.is_forbidden(path) {
        return Err(selection_error());
    }
    window
        .state::<DocumentAccess>()
        .authorize(path, directory, scope.is_allowed(path))
}

/// A save dialog can authorize a path before it exists. Remember its canonical
/// identity after a successful creation, without turning a committed save into
/// a reported failure if persistence becomes unavailable.
pub fn remember_created(window: &Window, path: &Path, directory: bool) {
    if window.fs_scope().is_allowed(path) {
        let _ = window
            .state::<DocumentAccess>()
            .authorize(path, directory, true);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (PathBuf, DocumentAccess) {
        let root = std::env::temp_dir().join(format!("maca-access-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let access = DocumentAccess::load(root.join("state/approved-documents.json"));
        (root, access)
    }

    #[test]
    fn rejects_unselected_paths_and_persists_only_native_approvals() {
        let (root, access) = fixture();
        let selected = root.join("selected.mdpkg");
        let outside = root.join("outside.mdpkg");
        std::fs::write(&selected, b"selected").unwrap();
        std::fs::write(&outside, b"private canary").unwrap();
        assert!(access.authorize(&outside, false, false).is_err());
        assert!(access.authorize(&selected, false, true).is_ok());
        let restored = DocumentAccess::load(access.file.clone());
        assert!(restored.authorize(&selected, false, false).is_ok());
        assert!(restored.authorize(&outside, false, false).is_err());
        assert!(restored.authorize(&selected, true, false).is_err());
        assert_eq!(std::fs::read(&outside).unwrap(), b"private canary");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn folder_approval_is_exact_not_a_prefix_or_descendant_grant() {
        let (root, access) = fixture();
        let folder = root.join("book");
        std::fs::create_dir(&folder).unwrap();
        std::fs::write(folder.join("secret"), b"canary").unwrap();
        assert!(access.authorize(&folder, true, true).is_ok());
        assert!(access.authorize(&folder, true, false).is_ok());
        assert!(access
            .authorize(&folder.join("secret"), false, false)
            .is_err());
        assert!(access
            .authorize(&root.join("book-other"), true, false)
            .is_err());
        assert!(access
            .authorize(&folder.join("../outside"), true, true)
            .is_err());
        assert!(access
            .authorize(Path::new("relative"), false, true)
            .is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn even_selected_paths_cannot_modify_private_approvals_or_cover_their_parent() {
        let (root, access) = fixture();
        assert!(access.authorize(&access.file, false, true).is_err());
        assert!(access.authorize(&root, true, true).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn new_save_destinations_are_remembered_only_after_the_file_exists() {
        let (root, access) = fixture();
        let target = root.join("new.mdpkg");
        access.authorize(&target, false, true).unwrap();
        assert!(access.authorize(&target, false, false).is_err());
        std::fs::write(&target, b"saved").unwrap();
        access.authorize(&target, false, true).unwrap();
        let restored = DocumentAccess::load(access.file.clone());
        assert!(restored.authorize(&target, false, false).is_ok());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn replacing_an_approved_path_with_a_symlink_does_not_authorize_target() {
        let (root, access) = fixture();
        let file = root.join("selected");
        let outside = root.join("outside");
        std::fs::write(&file, b"selected").unwrap();
        std::fs::write(&outside, b"canary").unwrap();
        access.authorize(&file, false, true).unwrap();
        std::fs::remove_file(&file).unwrap();
        std::os::unix::fs::symlink(&outside, &file).unwrap();
        assert!(access.authorize(&file, false, false).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
