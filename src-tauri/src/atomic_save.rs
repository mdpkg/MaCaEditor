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
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "package".to_string());
    let temp_path = parent.join(format!(".{file_name}.tmp"));

    // 一時ファイルに書き込む
    let mut file = fs::File::create(&temp_path)?;
    std::io::Write::write_all(&mut file, data)?;
    file.sync_all()?;
    drop(file);

    // atomic replace
    // Windows では fs::rename が既存ファイルを上書きできないため、
    // 既存ファイルを退避してから置き換える
    if path.exists() {
        let backup_path = parent.join(format!(".{file_name}.bak"));
        fs::rename(path, &backup_path)?;
        match fs::rename(&temp_path, path) {
            Ok(()) => {
                let _ = fs::remove_file(&backup_path);
                Ok(())
            }
            Err(e) => {
                let _ = fs::rename(&backup_path, path);
                Err(e.into())
            }
        }
    } else {
        fs::rename(&temp_path, path)?;
        Ok(())
    }
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
