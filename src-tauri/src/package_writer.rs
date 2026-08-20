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
    // manifest.json は上で常に書き込むため、files に含まれている場合はスキップする
    // （load_package は manifest.json を files に含めるため、そのまま保存すると重複する）
    for file in files {
        if file.path.replace('\\', "/") == "manifest.json" {
            continue;
        }
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
        // manifest.json は files に含まれない（manifest として別途保持される）
        assert_eq!(loaded.files.len(), 2); // README + png
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
    fn save_after_load_does_not_duplicate_manifest() {
        // load_package は manifest.json を files に含めてしまうため、
        // そのまま write_package すると manifest.json が2回書き込まれる。
        let manifest = manifest();
        let files = vec![PackageFile::new_text("README.md".to_string(), "# Hello".to_string())];
        let zip = write_package(&manifest, &files).unwrap();
        let loaded = load_package(&zip).unwrap();

        // 開いた直後に保存しても Duplicate filename エラーにならないこと
        let result = write_package(&loaded.manifest, &loaded.files);
        assert!(result.is_ok(), "save after load should not fail: {:?}", result.err());
    }

    #[test]
    fn end_to_end_save_flow_with_real_package() {
        // example/drawing-example の実パッケージを読み込んで ZIP を作成する
        let base = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../example/drawing-example");
        let manifest_bytes = std::fs::read(base.join("manifest.json")).unwrap();
        let readme_bytes = std::fs::read(base.join("README.md")).unwrap();
        let draw_bytes = std::fs::read(base.join("diagrams/architecture.draw.json")).unwrap();
        let svg_bytes = std::fs::read(base.join("diagrams/architecture.svg")).unwrap();

        // 実パッケージ相当の ZIP を組み立てる
        let mut buf = Vec::new();
        let mut writer = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
        for (name, content) in [
            ("manifest.json", manifest_bytes.as_slice()),
            ("README.md", readme_bytes.as_slice()),
            ("diagrams/architecture.draw.json", draw_bytes.as_slice()),
            ("diagrams/architecture.svg", svg_bytes.as_slice()),
        ] {
            writer
                .start_file(name, zip::write::FullFileOptions::default())
                .unwrap();
            writer.write_all(content).unwrap();
        }
        writer.finish().unwrap();

        // load → write → load のエンドツーエンド保存フロー
        let loaded = load_package(&buf).unwrap();
        let saved = write_package(&loaded.manifest, &loaded.files).unwrap();
        let reloaded = load_package(&saved).unwrap();

        // manifest.json は files に含まれず、重複エントリが発生しない
        assert_eq!(loaded.files.len(), 3); // README + draw + svg
        assert_eq!(reloaded.files.len(), 3);
        assert!(
            reloaded
                .files
                .iter()
                .all(|f| f.path.replace('\\', "/") != "manifest.json"),
            "manifest.json must not be duplicated"
        );

        // 再読み込みでも実ファイルの内容が保持されている
        let draw = reloaded
            .files
            .iter()
            .find(|f| f.path == "diagrams/architecture.draw.json")
            .unwrap();
        assert!(draw.text_content().unwrap().contains("\"format\": \"maca-drawing\""));
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
