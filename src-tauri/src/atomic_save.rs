use std::fs;
use std::path::Path;

#[derive(Debug, thiserror::Error)]
pub enum SaveError {
    #[error("failed to save file: {0}")]
    Io(#[from] std::io::Error),
}

/// 一時ファイルに書き込んでから atomic replace する。
/// 保存途中に異常終了しても既存ファイルが破損しないようにする。
pub fn atomic_save(path: &Path, data: &[u8]) -> Result<(), SaveError> {
    let parent = path.parent().unwrap_or(Path::new("."));
    let temp_path = parent.join(format!(".maca-save-{}.tmp", uuid::Uuid::new_v4()));

    let mut file = fs::File::create_new(&temp_path)?;
    let result = (|| {
        std::io::Write::write_all(&mut file, data)?;
        file.sync_all()?;
        Ok(())
    })();
    drop(file);

    // Keep the old destination visible until the synchronized file replaces it.
    let result = result.and_then(|()| fs::rename(&temp_path, path));
    if result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    result.map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "maca_test_{}_{name}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn saves_content_to_file() {
        let dir = temp_dir("save");
        let path = dir.join("test.mdpkg");
        atomic_save(&path, b"content").unwrap();
        let content = fs::read(&path).unwrap();
        assert_eq!(content, b"content");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn replaces_existing_file() {
        let dir = temp_dir("replace");
        let path = dir.join("test.mdpkg");
        fs::write(&path, b"old").unwrap();
        atomic_save(&path, b"new").unwrap();
        let content = fs::read(&path).unwrap();
        assert_eq!(content, b"new");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn preserves_an_existing_backup_when_replacing_a_file() {
        let dir = temp_dir("preserve_backup");
        let path = dir.join("test.mdpkg");
        let backup = dir.join(".test.mdpkg.bak");
        fs::write(&path, b"old").unwrap();
        fs::write(&backup, b"existing backup").unwrap();
        atomic_save(&path, b"new").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"new");
        assert_eq!(fs::read(&backup).unwrap(), b"existing backup");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_failed_replacement_preserves_the_destination_and_cleans_up() {
        let dir = temp_dir("preserve_directory");
        let path = dir.join("test.mdpkg");
        fs::create_dir(&path).unwrap();
        fs::write(path.join("keep"), b"existing contents").unwrap();
        assert!(atomic_save(&path, b"new").is_err());
        assert_eq!(fs::read(path.join("keep")).unwrap(), b"existing contents");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn does_not_leave_temp_file() {
        let dir = temp_dir("temp");
        let path = dir.join("test.mdpkg");
        atomic_save(&path, b"content").unwrap();
        let entries = fs::read_dir(&dir).unwrap().count();
        assert_eq!(entries, 1); // 一時ファイルは残らない
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn fails_on_unwritable_path() {
        let dir = temp_dir("unwritable");
        let path = dir.join("nonexistent_dir").join("test.mdpkg");
        let result = atomic_save(&path, b"content");
        assert!(result.is_err());
        fs::remove_dir_all(&dir).unwrap();
    }
}
