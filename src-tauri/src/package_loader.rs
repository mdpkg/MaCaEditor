use std::io::Read;

use crate::manifest::{Manifest, ManifestError};
use crate::package_file::PackageFile;
use crate::package_validation::{
    validate_entrypoint_exists, validate_manifest, validate_paths, ValidationError,
};
use crate::path_validator::{validate_package_path, PathError};

#[derive(Debug, thiserror::Error)]
pub enum LoadError {
    #[error("not a zip archive: {0}")]
    NotZip(#[from] zip::result::ZipError),
    #[error("manifest.json is missing")]
    MissingManifest,
    #[error("manifest.json is invalid: {0}")]
    InvalidManifest(#[from] ManifestError),
    #[error("invalid package: {0}")]
    InvalidPackage(#[from] ValidationError),
    #[error("unsafe path \"{0}\" in package")]
    UnsafePath(String),
    #[error("failed to read entry \"{0}\": {1}")]
    ReadFailed(String, String),
}

#[derive(Debug, Clone)]
pub struct LoadedPackage {
    pub manifest: Manifest,
    pub files: Vec<PackageFile>,
}

/// ZIP から Markdown Package を読み込む。
pub fn load_package(data: &[u8]) -> Result<LoadedPackage, LoadError> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(data))
        .map_err(LoadError::NotZip)?;

    // まずエントリ名をすべて検証してから読み込む
    let mut names: Vec<String> = Vec::new();
    for i in 0..archive.len() {
        let entry = archive.by_index(i).map_err(LoadError::NotZip)?;
        let name = entry.name().to_string();
        validate_package_path(&name).map_err(|e| match e {
            PathError::Empty | PathError::InvalidSegment | PathError::OutsidePackage => {
                LoadError::UnsafePath(name.clone())
            }
        })?;
        names.push(name);
    }

    // manifest.json を取得
    let manifest_index = names
        .iter()
        .position(|n| n.replace('\\', "/") == "manifest.json")
        .ok_or(LoadError::MissingManifest)?;

    let mut manifest_bytes = Vec::new();
    {
        let mut entry = archive
            .by_index(manifest_index)
            .map_err(LoadError::NotZip)?;
        entry
            .read_to_end(&mut manifest_bytes)
            .map_err(|e| LoadError::ReadFailed("manifest.json".to_string(), e.to_string()))?;
    }

    let manifest_json = String::from_utf8(manifest_bytes)
        .map_err(|e| LoadError::InvalidManifest(ManifestError::InvalidJson(serde_json::Error::io(std::io::Error::new(std::io::ErrorKind::InvalidData, e)))))?;
    let manifest = Manifest::parse(&manifest_json)?;

    validate_manifest(&manifest)?;
    validate_paths(&manifest)?;

    // 全ファイルを読み込む
    // manifest.json は manifest として別途保持するため files には含めない
    // （write_package は manifest.json を常に書き込むため、含めると重複してしまう）
    let mut files: Vec<PackageFile> = Vec::new();
    for (i, name) in names.iter().enumerate() {
        if name.replace('\\', "/") == "manifest.json" {
            continue;
        }
        let mut entry = archive.by_index(i).map_err(LoadError::NotZip)?;
        let mut content = Vec::new();
        entry
            .read_to_end(&mut content)
            .map_err(|e| LoadError::ReadFailed(name.clone(), e.to_string()))?;

        let file = if is_text(name) {
            match String::from_utf8(content.clone()) {
                Ok(text) => PackageFile::new_text(name.clone(), text),
                Err(_) => PackageFile::new_binary(name.clone(), content),
            }
        } else {
            PackageFile::new_binary(name.clone(), content)
        };
        files.push(file);
    }

    // entrypoint の存在を検証
    let file_paths: Vec<String> = files.iter().map(|f| f.path.clone()).collect();
    validate_entrypoint_exists(&manifest, &file_paths)?;

    Ok(LoadedPackage { manifest, files })
}

/// 拡張子からテキストファイルかどうかを判定する。
fn is_text(name: &str) -> bool {
    let lower = name.to_lowercase();
    matches!(
        lower.as_str(),
        "readme.md"
            | "manifest.json"
    ) || lower.ends_with(".md")
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::FullFileOptions;
    use zip::ZipWriter;

    fn build_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut buf = Vec::new();
        let mut writer = ZipWriter::new(std::io::Cursor::new(&mut buf));
        for (name, content) in entries {
            writer.start_file(name, FullFileOptions::default()).unwrap();
            writer.write_all(content).unwrap();
        }
        writer.finish().unwrap();
        buf
    }

    #[test]
    fn loads_manifest_from_zip() {
        let manifest = br#"{ "format": "mdpkg", "version": "1.0", "entrypoint": "README.md", "title": "T" }"#;
        let readme = b"# Hello";
        let zip = build_zip(&[("manifest.json", manifest), ("README.md", readme)]);
        let loaded = load_package(&zip).unwrap();
        assert_eq!(loaded.manifest.format, "mdpkg");
        assert_eq!(loaded.manifest.entrypoint, "README.md");
    }

    #[test]
    fn loads_entrypoint_content() {
        let manifest = br#"{ "format": "mdpkg", "version": "1.0", "entrypoint": "README.md", "title": "T" }"#;
        let readme = b"# Hello";
        let zip = build_zip(&[("manifest.json", manifest), ("README.md", readme)]);
        let loaded = load_package(&zip).unwrap();
        let readme_file = loaded
            .files
            .iter()
            .find(|f| f.path == "README.md")
            .unwrap();
        assert_eq!(readme_file.text_content(), Some("# Hello"));
    }

    #[test]
    fn rejects_non_zip() {
        let result = load_package(b"not a zip");
        assert!(matches!(result, Err(LoadError::NotZip(_))));
    }

    #[test]
    fn rejects_missing_manifest() {
        let zip = build_zip(&[("README.md", b"# Hello")]);
        let result = load_package(&zip);
        assert!(matches!(result, Err(LoadError::MissingManifest)));
    }

    #[test]
    fn rejects_path_traversal_entry() {
        let manifest = br#"{ "format": "mdpkg", "version": "1.0", "entrypoint": "README.md", "title": "T" }"#;
        let zip = build_zip(&[
            ("manifest.json", manifest),
            ("../evil.txt", b"evil"),
        ]);
        let result = load_package(&zip);
        assert!(matches!(result, Err(LoadError::UnsafePath(_))));
    }

    #[test]
    fn rejects_missing_entrypoint() {
        let manifest = br#"{ "format": "mdpkg", "version": "1.0", "entrypoint": "missing.md", "title": "T" }"#;
        let zip = build_zip(&[("manifest.json", manifest)]);
        let result = load_package(&zip);
        assert!(matches!(
            result,
            Err(LoadError::InvalidPackage(ValidationError::EntrypointNotFound(_)))
        ));
    }

    #[test]
    fn manifest_is_not_included_in_files_list() {
        let manifest = br#"{ "format": "mdpkg", "version": "1.0", "entrypoint": "README.md", "title": "T" }"#;
        let readme = b"# Hello";
        let zip = build_zip(&[("manifest.json", manifest), ("README.md", readme)]);
        let loaded = load_package(&zip).unwrap();
        // manifest.json は files に含めない（write_package が常に書き込むため）
        assert!(
            loaded
                .files
                .iter()
                .all(|f| f.path.replace('\\', "/") != "manifest.json"),
            "manifest.json must not be in files list"
        );
    }

    #[test]
    fn loads_binary_file() {
        let manifest = br#"{ "format": "mdpkg", "version": "1.0", "entrypoint": "README.md", "title": "T" }"#;
        let zip = build_zip(&[
            ("manifest.json", manifest),
            ("README.md", b"# Hello"),
            ("images/a.png", &[0x89, 0x50, 0x4e, 0x47]),
        ]);
        let loaded = load_package(&zip).unwrap();
        let png = loaded.files.iter().find(|f| f.path == "images/a.png").unwrap();
        assert!(!png.is_text());
    }

    #[test]
    fn loads_svg_as_text() {
        let manifest = br#"{ "format": "mdpkg", "version": "1.0", "entrypoint": "README.md", "title": "T" }"#;
        let svg = br##"<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#eee"/></svg>"##;
        let zip = build_zip(&[
            ("manifest.json", manifest),
            ("README.md", b"# Hello"),
            ("diagrams/architecture.svg", svg),
        ]);
        let loaded = load_package(&zip).unwrap();
        let svg_file = loaded.files.iter().find(|f| f.path == "diagrams/architecture.svg").unwrap();
        assert!(svg_file.is_text());
        assert!(svg_file.text_content().unwrap().contains("<svg"));
    }
}
