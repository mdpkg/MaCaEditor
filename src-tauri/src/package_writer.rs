use std::io::Write;

use crate::manifest::Manifest;
use crate::package_file::PackageFile;
use crate::path_validator::validate_package_path;

#[derive(Debug, thiserror::Error)]
pub enum WriteError {
    #[error("unsafe path \"{0}\"")]
    UnsafePath(String),
    #[error("failed to write zip: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

/// Document Model から ZIP を生成する。
pub fn write_package(manifest: &Manifest, files: &[PackageFile]) -> Result<Vec<u8>, WriteError> {
    let mut buf = Vec::new();
    let mut writer = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));

    // manifest.json を常に書き込む
    let manifest_json = serde_json::to_string_pretty(manifest)
        .map_err(|e| WriteError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e)))?;
    writer
        .start_file("manifest.json", zip::write::FullFileOptions::default())
        .map_err(WriteError::Zip)?;
    writer.write_all(manifest_json.as_bytes()).map_err(WriteError::Io)?;

    // 各ファイルを書き込む
    for file in files {
        validate_package_path(&file.path).map_err(|_| WriteError::UnsafePath(file.path.clone()))?;
        writer
            .start_file(&file.path, zip::write::FullFileOptions::default())
            .map_err(WriteError::Zip)?;
        writer.write_all(&file.content).map_err(WriteError::Io)?;
    }

    writer.finish().map_err(WriteError::Zip)?;
    Ok(buf)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::package_loader::load_package;

    fn manifest() -> Manifest {
        Manifest::parse(
            r#"{ "format": "mdpkg", "version": "1.0", "entrypoint": "README.md", "title": "T", "custom": 1 }"#,
        )
        .unwrap()
    }

    #[test]
    fn writes_manifest_and_files() {
        let manifest = manifest();
        let files = vec![
            PackageFile::new_text("README.md".to_string(), "# Hello".to_string()),
            PackageFile::new_binary("images/a.png".to_string(), vec![0x89, 0x50]),
        ];
        let zip = write_package(&manifest, &files).unwrap();
        let loaded = load_package(&zip).unwrap();
        assert_eq!(loaded.manifest.format, "mdpkg");
        assert_eq!(loaded.files.len(), 3); // manifest + README + png
    }

    #[test]
    fn preserves_unknown_manifest_fields() {
        let manifest = manifest();
        let files = vec![PackageFile::new_text("README.md".to_string(), "# Hello".to_string())];
        let zip = write_package(&manifest, &files).unwrap();
        let loaded = load_package(&zip).unwrap();
        assert_eq!(loaded.manifest.unknown.get("custom").unwrap().as_i64(), Some(1));
    }

    #[test]
    fn rejects_unsafe_path() {
        let manifest = manifest();
        let files = vec![PackageFile::new_text("../evil.md".to_string(), "evil".to_string())];
        let result = write_package(&manifest, &files);
        assert!(matches!(result, Err(WriteError::UnsafePath(_))));
    }

    #[test]
    fn written_zip_is_readable_as_zip() {
        let manifest = manifest();
        let files = vec![PackageFile::new_text("README.md".to_string(), "# Hello".to_string())];
        let zip = write_package(&manifest, &files).unwrap();
        let archive = zip::ZipArchive::new(std::io::Cursor::new(&zip)).unwrap();
        assert!(archive.len() >= 2);
    }
}
