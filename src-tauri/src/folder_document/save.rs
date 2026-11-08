use std::collections::BTreeMap;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use super::{
    ensure_inside, folder_revision, ignored_inference_directory, load_folder, load_folder_inner,
    reject_link, validate_document, FolderError, Manifest, PackageFile, SAVE_DIRECTORY,
};
use crate::path_validator::validate_package_path;

pub fn save_folder(
    path: &Path,
    manifest: &Manifest,
    files: &[PackageFile],
    original: &[String],
    expected_revision: &str,
) -> Result<String, FolderError> {
    save_folder_with_checkpoint(path, manifest, files, original, expected_revision, |_| {})
}

pub fn save_folder_with_checkpoint(
    path: &Path,
    manifest: &Manifest,
    files: &[PackageFile],
    original: &[String],
    expected_revision: &str,
    prepare_checkpoint: impl FnOnce(&str),
) -> Result<String, FolderError> {
    save_folder_with(
        path,
        manifest,
        files,
        original,
        expected_revision,
        |_| Ok(()),
        prepare_checkpoint,
    )
}

struct WriteFile<'a> {
    path: &'a str,
    content: &'a [u8],
    original: Option<&'a [u8]>,
}

pub(super) fn save_folder_with(
    path: &Path,
    manifest: &Manifest,
    files: &[PackageFile],
    original: &[String],
    expected_revision: &str,
    mut before_publish: impl FnMut(&Path) -> io::Result<()>,
    prepare_checkpoint: impl FnOnce(&str),
) -> Result<String, FolderError> {
    let loaded = load_folder(path)?;
    if loaded.revision != expected_revision {
        return Err(FolderError::Conflict);
    }
    validate_document(manifest, files)?;
    let root = &loaded.root;
    let old: BTreeMap<_, _> = loaded
        .files
        .iter()
        .map(|file| (file.path.clone(), file.content.as_slice()))
        .collect();
    let mut next = BTreeMap::new();
    for file in files {
        let path = save_path(&file.path)?;
        if next.insert(path, file.content.as_slice()).is_some() {
            return Err(FolderError::Invalid(format!(
                "duplicate path: {}",
                file.path
            )));
        }
    }
    for path in next.keys() {
        if path
            .match_indices('/')
            .any(|(index, _)| next.contains_key(&path[..index]))
        {
            return Err(FolderError::Invalid(format!(
                "file has a file as parent: {path}"
            )));
        }
    }
    let mut removals = BTreeMap::new();
    for path in original {
        let path = save_path(path)?;
        if !next.contains_key(&path) {
            if let Some(bytes) = old.get(&path) {
                removals.insert(path, *bytes);
            }
        }
    }
    let writes: Vec<_> = next
        .iter()
        .filter_map(|(path, content)| {
            let original = old.get(path).copied();
            (original != Some(*content)).then_some(WriteFile {
                path,
                content,
                original,
            })
        })
        .collect();
    let manifest_bytes = serde_json::to_vec_pretty(manifest)
        .map_err(|error| FolderError::Invalid(error.to_string()))?;
    let manifest_write = WriteFile {
        path: "manifest.json",
        content: &manifest_bytes,
        original: loaded.manifest_bytes.as_deref(),
    };
    let write_manifest = manifest_write.original != Some(manifest_write.content);
    if writes.is_empty() && removals.is_empty() && !write_manifest {
        prepare_checkpoint(&loaded.revision);
        return Ok(loaded.revision);
    }
    let retained = old
        .iter()
        .filter(|(path, _)| !removals.contains_key(*path) && !next.contains_key(*path));
    let planned: BTreeMap<_, _> = next
        .iter()
        .chain(retained)
        .map(|(path, content)| (path.as_str(), *content))
        .collect();
    let planned_revision = folder_revision(
        Some(&manifest_bytes),
        planned.iter().map(|(&path, &content)| (path, content)),
    );

    let stage = root.join(SAVE_DIRECTORY);
    fs::create_dir(&stage).map_err(|error| {
        if error.kind() == io::ErrorKind::AlreadyExists {
            FolderError::Recovery(stage.clone(), "another save or backup is present".into())
        } else {
            error.into()
        }
    })?;
    let mut transaction = Transaction {
        root,
        stage: &stage,
        undo: Vec::new(),
    };
    let result = (|| {
        for (index, write) in writes
            .iter()
            .chain(write_manifest.then_some(&manifest_write))
            .enumerate()
        {
            let mut file = fs::File::create(transaction.staged(index))?;
            file.write_all(write.content)?;
            file.sync_all()?;
        }
        if load_folder_inner(root, true)?.revision != expected_revision {
            return Err(FolderError::Conflict);
        }
        prepare_checkpoint(&planned_revision);
        // Retire a blocking path before publishing only when a file and directory trade places.
        let (blockers, remaining): (Vec<_>, Vec<_>) = removals.iter().partition(|(old, _)| {
            writes
                .iter()
                .any(|write| ancestor(old, write.path) || ancestor(write.path, old))
        });
        for (path, bytes) in blockers {
            transaction.retire(path, bytes)?;
        }
        for (index, write) in writes.iter().enumerate() {
            transaction.publish(index, write, &mut before_publish)?;
        }
        for (path, bytes) in remaining {
            transaction.retire(path, bytes)?;
        }
        if write_manifest {
            transaction.publish(writes.len(), &manifest_write, &mut before_publish)?;
        }
        let written = load_folder_inner(root, true)?;
        if written.revision != planned_revision {
            if loaded.manifest_bytes.is_some()
                || written.manifest_bytes.as_deref() != Some(&manifest_bytes)
            {
                return Err(FolderError::Conflict);
            }
            // The first manifest makes directories skipped during inference visible to future scans.
            let actual: BTreeMap<_, _> = written
                .files
                .iter()
                .map(|file| (file.path.as_str(), file.content.as_slice()))
                .collect();
            if planned
                .iter()
                .any(|(path, content)| actual.get(path) != Some(content))
                || actual.keys().any(|path| {
                    !planned.contains_key(path)
                        && (removals.contains_key(*path) || !inside_inference_directory(path))
                })
            {
                return Err(FolderError::Conflict);
            }
        }
        Ok(written.revision)
    })();

    match result {
        Err(error) => {
            if let Err(rollback) = transaction.rollback() {
                return Err(FolderError::Recovery(
                    stage,
                    format!("{error}; rollback failed: {rollback}"),
                ));
            }
            fs::remove_dir_all(&stage)
                .map_err(|cleanup| FolderError::Recovery(stage, format!("{error}; {cleanup}")))?;
            Err(error)
        }
        Ok(revision) => {
            fs::remove_dir_all(&stage)
                .map_err(|error| FolderError::Recovery(stage, error.to_string()))?;
            Ok(revision)
        }
    }
}

fn inside_inference_directory(path: &str) -> bool {
    Path::new(path).parent().is_some_and(|parent| {
        parent
            .components()
            .any(|part| ignored_inference_directory(Path::new(part.as_os_str())))
    })
}

fn ancestor(parent: &str, path: &str) -> bool {
    path.strip_prefix(parent)
        .is_some_and(|suffix| suffix.starts_with('/'))
}

fn save_path(path: &str) -> Result<String, FolderError> {
    let path = path.replace('\\', "/");
    validate_package_path(&path).map_err(|_| FolderError::Outside(path.clone()))?;
    let top = path.split('/').next().unwrap_or_default();
    if top.eq_ignore_ascii_case(SAVE_DIRECTORY) || top.eq_ignore_ascii_case("manifest.json") {
        return Err(FolderError::Invalid(format!("reserved path: {path}")));
    }
    #[cfg(windows)]
    for part in path.split('/') {
        let stem = part
            .split('.')
            .next()
            .unwrap_or_default()
            .trim_end()
            .to_ascii_uppercase();
        let device = matches!(
            stem.as_str(),
            "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
        ) || ["COM", "LPT"].iter().any(|prefix| {
            stem.strip_prefix(prefix).is_some_and(|suffix| {
                matches!(
                    suffix,
                    "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                )
            })
        });
        if device
            || part.ends_with([' ', '.'])
            || part
                .chars()
                .any(|ch| ch.is_control() || "<>:\"|?*".contains(ch))
        {
            return Err(FolderError::Invalid(format!(
                "invalid Windows path: {path}"
            )));
        }
    }
    Ok(path)
}

fn metadata(path: &Path) -> io::Result<Option<fs::Metadata>> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => Ok(Some(metadata)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

fn check_file(path: &Path, expected: Option<&[u8]>) -> Result<(), FolderError> {
    match (metadata(path)?, expected) {
        (None, None) => Ok(()),
        (Some(metadata), Some(bytes)) if metadata.is_file() && fs::read(path)? == bytes => Ok(()),
        _ => Err(FolderError::Conflict),
    }
}

enum Undo<'a> {
    RestoreFile { target: PathBuf, backup: PathBuf },
    RemoveFile { target: PathBuf, content: &'a [u8] },
    RemoveDirectory(PathBuf),
    RestoreDirectory(PathBuf),
}

struct Transaction<'a> {
    root: &'a Path,
    stage: &'a Path,
    undo: Vec<Undo<'a>>,
}

impl<'a> Transaction<'a> {
    fn staged(&self, index: usize) -> PathBuf {
        self.stage.join(format!("write-{index}"))
    }

    fn prepare_parent(&mut self, target: &Path, create: bool) -> Result<(), FolderError> {
        let parent = target
            .parent()
            .ok_or_else(|| FolderError::Outside(target.display().to_string()))?;
        let relative = parent
            .strip_prefix(self.root)
            .map_err(|_| FolderError::Outside(target.display().to_string()))?;
        reject_link(self.root)?;
        let mut current = self.root.to_path_buf();
        for part in relative.components() {
            current.push(part);
            if create && metadata(&current)?.is_none() {
                fs::create_dir(&current)?;
                self.undo.push(Undo::RemoveDirectory(current.clone()));
            }
            reject_link(&current)?;
            ensure_inside(self.root, &current)?;
        }
        Ok(())
    }

    fn backup(
        &mut self,
        target: &Path,
        relative: &str,
        original: Option<&[u8]>,
    ) -> Result<(), FolderError> {
        check_file(target, original)?;
        if original.is_some() {
            let backup = self.stage.join("backup").join(relative);
            fs::create_dir_all(backup.parent().expect("backup path has a parent"))?;
            fs::rename(target, &backup)?;
            self.undo.push(Undo::RestoreFile {
                target: target.to_path_buf(),
                backup: backup.clone(),
            });
            check_file(&backup, original)?;
        }
        Ok(())
    }

    fn retire(&mut self, relative: &str, bytes: &[u8]) -> Result<(), FolderError> {
        let target = self.root.join(relative);
        self.prepare_parent(&target, false)?;
        self.backup(&target, relative, Some(bytes))
    }

    fn publish(
        &mut self,
        index: usize,
        write: &WriteFile<'a>,
        before_publish: &mut impl FnMut(&Path) -> io::Result<()>,
    ) -> Result<(), FolderError> {
        let target = self.root.join(write.path);
        self.prepare_parent(&target, true)?;
        if write.original.is_none() && metadata(&target)?.is_some_and(|value| value.is_dir()) {
            self.remove_empty_tree(&target)?;
        }
        self.backup(&target, write.path, write.original)?;
        before_publish(&target)?;
        check_file(&target, None)?;
        fs::rename(self.staged(index), &target)?;
        self.undo.push(Undo::RemoveFile {
            target,
            content: write.content,
        });
        Ok(())
    }

    fn remove_empty_tree(&mut self, path: &Path) -> Result<(), FolderError> {
        reject_link(path)?;
        ensure_inside(self.root, path)?;
        for child in fs::read_dir(path)? {
            let child = child?;
            if !child.file_type()?.is_dir() {
                return Err(FolderError::Conflict);
            }
            self.remove_empty_tree(&child.path())?;
        }
        fs::remove_dir(path)?;
        self.undo.push(Undo::RestoreDirectory(path.to_path_buf()));
        Ok(())
    }

    fn rollback(&mut self) -> Result<(), FolderError> {
        let mut first_error = None;
        while let Some(operation) = self.undo.pop() {
            if let Err(error) = self.rollback_one(operation) {
                first_error.get_or_insert(error);
            }
        }
        first_error.map_or(Ok(()), Err)
    }

    fn rollback_one(&mut self, operation: Undo<'a>) -> Result<(), FolderError> {
        let target = match &operation {
            Undo::RestoreFile { target, .. }
            | Undo::RemoveFile { target, .. }
            | Undo::RemoveDirectory(target)
            | Undo::RestoreDirectory(target) => target,
        };
        self.prepare_parent(target, false)?;
        match operation {
            Undo::RestoreFile { target, backup } => {
                check_file(&target, None)?;
                fs::rename(backup, target)?;
            }
            Undo::RemoveFile { target, content } => {
                check_file(&target, Some(content))?;
                fs::remove_file(target)?;
            }
            Undo::RemoveDirectory(target) => {
                reject_link(&target)?;
                fs::remove_dir(target)?;
            }
            Undo::RestoreDirectory(target) => fs::create_dir(target)?,
        }
        Ok(())
    }
}
