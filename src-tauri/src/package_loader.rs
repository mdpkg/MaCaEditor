use std::io::Read;
use std::collections::HashSet;
use unicode_normalization::UnicodeNormalization;

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
    #[error("duplicate or Unicode-colliding path \"{0}\"")]
    DuplicatePath(String),
    #[error("archive contains too many entries: {0}")]
    TooManyEntries(usize),
    #[error("archive entry is too large: {0} bytes")]
    FileTooLarge(u64),
    #[error("archive expands beyond the size limit: {0} bytes")]
    ArchiveTooLarge(u64),
    #[error("archive contains a suspicious compression ratio")]
    SuspiciousCompressionRatio,
}

const MAX_ARCHIVE_ENTRIES: usize = 10_000;
const MAX_FILE_UNCOMPRESSED_SIZE: u64 = 128 * 1024 * 1024;
const MAX_ARCHIVE_UNCOMPRESSED_SIZE: u64 = 512 * 1024 * 1024;
const MIN_RATIO_CHECK_SIZE: u64 = 1024 * 1024;
const MAX_COMPRESSION_RATIO: u64 = 1_000;

fn validate_archive_limits(sizes: &[(u64, u64)]) -> Result<(), LoadError> {
    if sizes.len() > MAX_ARCHIVE_ENTRIES {
        return Err(LoadError::TooManyEntries(sizes.len()));
    }
    let mut total = 0_u64;
    for &(uncompressed, compressed) in sizes {
        if uncompressed > MAX_FILE_UNCOMPRESSED_SIZE {
            return Err(LoadError::FileTooLarge(uncompressed));
        }
        total = total.saturating_add(uncompressed);
        if total > MAX_ARCHIVE_UNCOMPRESSED_SIZE {
            return Err(LoadError::ArchiveTooLarge(total));
        }
        if uncompressed >= MIN_RATIO_CHECK_SIZE &&
            (compressed == 0 || uncompressed / compressed > MAX_COMPRESSION_RATIO)
        {
            return Err(LoadError::SuspiciousCompressionRatio);
        }
    }
    Ok(())
}

#[derive(Debug, Clone)]
pub struct LoadedPackage {
    pub manifest: Manifest,
    pub files: Vec<PackageFile>,
}

/// ZIP から Markdown Package を読み込む。
pub fn load_package(data: &[u8]) -> Result<LoadedPackage, LoadError> {
    let mut archive =
        zip::ZipArchive::new(std::io::Cursor::new(data)).map_err(LoadError::NotZip)?;

    let sizes = (0..archive.len()).map(|index| {
        let entry = archive.by_index(index).map_err(LoadError::NotZip)?;
        Ok((entry.size(), entry.compressed_size()))
    }).collect::<Result<Vec<_>, LoadError>>()?;
    validate_archive_limits(&sizes)?;

    // まずエントリ名をすべて検証してから読み込む
    let mut entries: Vec<(usize, String)> = Vec::new();
    let mut normalized_paths = HashSet::new();
    for i in 0..archive.len() {
        let entry = archive.by_index(i).map_err(LoadError::NotZip)?;
        let name = entry.name().to_string();
        let path_to_validate = name.trim_end_matches('/');
        validate_package_path(path_to_validate).map_err(|e| match e {
            PathError::Empty | PathError::InvalidSegment | PathError::OutsidePackage => {
                LoadError::UnsafePath(name.clone())
            }
        })?;
        let collision_key = path_to_validate.replace('\\', "/").nfc().collect::<String>();
        if !normalized_paths.insert(collision_key) {
            return Err(LoadError::DuplicatePath(name));
        }
        if !entry.is_dir() {
            entries.push((i, name));
        }
    }

    // manifest.json を取得
    let manifest_index = entries
        .iter()
        .find(|(_, name)| name.replace('\\', "/") == "manifest.json")
        .map(|(index, _)| *index)
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

    let manifest_json = String::from_utf8(manifest_bytes).map_err(|e| {
        LoadError::InvalidManifest(ManifestError::InvalidJson(serde_json::Error::io(
            std::io::Error::new(std::io::ErrorKind::InvalidData, e),
        )))
    })?;
    let manifest = Manifest::parse(&manifest_json)?;

    validate_manifest(&manifest)?;
    validate_paths(&manifest)?;

    // 全ファイルを読み込む
    // manifest.json は manifest として別途保持するため files には含めない
    // （write_package は manifest.json を常に書き込むため、含めると重複してしまう）
    let mut files: Vec<PackageFile> = Vec::new();
    for (i, name) in &entries {
        if name.replace('\\', "/") == "manifest.json" {
            continue;
        }
        let mut entry = archive.by_index(*i).map_err(LoadError::NotZip)?;
        let mut content = Vec::new();
        entry
            .read_to_end(&mut content)
            .map_err(|e| LoadError::ReadFailed(name.clone(), e.to_string()))?;

        let file = if is_text_path(name) {
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
pub(crate) fn is_text_path(name: &str) -> bool {
    let lower = name.to_lowercase();
    matches!(lower.as_str(), "readme.md" | "manifest.json")
        || lower.ends_with(".md")
        || lower.ends_with(".markdown")
        || lower.ends_with(".json")
        || lower.ends_with(".yaml")
        || lower.ends_with(".yml")
        || lower.ends_with(".puml")
        || lower.ends_with(".mmd")
        || lower.ends_with(".tex")
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
        let manifest =
            br#"{ "format": "mdpkg", "version": "1.0", "entrypoint": "README.md", "title": "T" }"#;
        let readme = b"# Hello";
        let zip = build_zip(&[("manifest.json", manifest), ("README.md", readme)]);
        let loaded = load_package(&zip).unwrap();
        assert_eq!(loaded.manifest.format, "mdpkg");
        assert_eq!(loaded.manifest.entrypoint, "README.md");
    }

    #[test]
    fn loads_entrypoint_content() {
        let manifest =
            br#"{ "format": "mdpkg", "version": "1.0", "entrypoint": "README.md", "title": "T" }"#;
        let readme = b"# Hello";
        let zip = build_zip(&[("manifest.json", manifest), ("README.md", readme)]);
        let loaded = load_package(&zip).unwrap();
        let readme_file = loaded.files.iter().find(|f| f.path == "README.md").unwrap();
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
        let manifest =
            br#"{ "format": "mdpkg", "version": "1.0", "entrypoint": "README.md", "title": "T" }"#;
        let zip = build_zip(&[("manifest.json", manifest), ("../evil.txt", b"evil")]);
        let result = load_package(&zip);
        assert!(matches!(result, Err(LoadError::UnsafePath(_))));
    }

    #[test]
    fn rejects_missing_entrypoint() {
        let manifest =
            br#"{ "format": "mdpkg", "version": "1.0", "entrypoint": "missing.md", "title": "T" }"#;
        let zip = build_zip(&[("manifest.json", manifest)]);
        let result = load_package(&zip);
        assert!(matches!(
            result,
            Err(LoadError::InvalidPackage(
                ValidationError::EntrypointNotFound(_)
            ))
        ));
    }

    #[test]
    fn manifest_is_not_included_in_files_list() {
        let manifest =
            br#"{ "format": "mdpkg", "version": "1.0", "entrypoint": "README.md", "title": "T" }"#;
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
        let manifest =
            br#"{ "format": "mdpkg", "version": "1.0", "entrypoint": "README.md", "title": "T" }"#;
        let zip = build_zip(&[
            ("manifest.json", manifest),
            ("README.md", b"# Hello"),
            ("images/a.png", &[0x89, 0x50, 0x4e, 0x47]),
        ]);
        let loaded = load_package(&zip).unwrap();
        let png = loaded
            .files
            .iter()
            .find(|f| f.path == "images/a.png")
            .unwrap();
        assert!(!png.is_text());
    }

    #[test]
    fn loads_svg_as_text() {
        let manifest =
            br#"{ "format": "mdpkg", "version": "1.0", "entrypoint": "README.md", "title": "T" }"#;
        let svg = br##"<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#eee"/></svg>"##;
        let zip = build_zip(&[
            ("manifest.json", manifest),
            ("README.md", b"# Hello"),
            ("diagrams/architecture.svg", svg),
        ]);
        let loaded = load_package(&zip).unwrap();
        let svg_file = loaded
            .files
            .iter()
            .find(|f| f.path == "diagrams/architecture.svg")
            .unwrap();
        assert!(svg_file.is_text());
        assert!(svg_file.text_content().unwrap().contains("<svg"));
    }

    #[test]
    fn loads_mathjax_tex_source_as_text() {
        let manifest = br#"{
            "format": "mdpkg",
            "version": "1.0",
            "entrypoint": "README.md",
            "title": "T",
            "resources": [
                { "source": "diagrams/math-1.tex", "rendered": "diagrams/math-1.svg", "type": "mathjax" }
            ]
        }"#;
        let tex = br#"\frac{-b \pm \sqrt{b^2 - 4ac}}{2a}"#;
        let zip = build_zip(&[
            ("manifest.json", manifest),
            ("README.md", b"# Hello"),
            ("diagrams/math-1.tex", tex),
            ("diagrams/math-1.svg", b"<svg></svg>"),
        ]);

        let loaded = load_package(&zip).unwrap();
        let tex_file = loaded
            .files
            .iter()
            .find(|file| file.path == "diagrams/math-1.tex")
            .unwrap();

        assert!(tex_file.is_text());
        assert_eq!(
            tex_file.text_content(),
            Some(r"\frac{-b \pm \sqrt{b^2 - 4ac}}{2a}")
        );
    }

    #[test]
    fn ignores_empty_zip_directories() {
        let manifest = br#"{"format":"mdpkg","version":"2.0","entrypoint":"index.md"}"#;
        let mut buf = Vec::new();
        let mut writer = ZipWriter::new(std::io::Cursor::new(&mut buf));
        writer.add_directory("empty/", FullFileOptions::default()).unwrap();
        writer.start_file("manifest.json", FullFileOptions::default()).unwrap();
        writer.write_all(manifest).unwrap();
        writer.start_file("index.md", FullFileOptions::default()).unwrap();
        writer.write_all(b"# Index").unwrap();
        writer.finish().unwrap();
        let loaded = load_package(&buf).unwrap();
        assert_eq!(loaded.files.len(), 1);
        assert_eq!(loaded.files[0].path, "index.md");
    }

    #[test]
    fn rejects_paths_that_collide_after_separator_normalization() {
        let manifest = br#"{"format":"mdpkg","version":"2.0","entrypoint":"index.md"}"#;
        let zip = build_zip(&[
            ("manifest.json", manifest),
            ("index.md", b"# Index"),
            ("docs\\guide.md", b"# First"),
            ("docs/guide.md", b"# Second"),
        ]);
        assert!(matches!(load_package(&zip), Err(LoadError::DuplicatePath(_))));
    }

    #[test]
    fn rejects_paths_that_collide_after_unicode_normalization() {
        let manifest = br#"{"format":"mdpkg","version":"2.0","entrypoint":"index.md"}"#;
        let zip = build_zip(&[
            ("manifest.json", manifest),
            ("index.md", b"# Index"),
            ("images/\u{00e9}.png", b"one"),
            ("images/e\u{0301}.png", b"two"),
        ]);
        assert!(matches!(load_package(&zip), Err(LoadError::DuplicatePath(_))));
    }

    #[test]
    fn rejects_archives_with_too_many_entries() {
        let entries = vec![(1_u64, 1_u64); MAX_ARCHIVE_ENTRIES + 1];
        assert!(matches!(validate_archive_limits(&entries), Err(LoadError::TooManyEntries(_))));
    }

    #[test]
    fn rejects_oversized_files_and_archives() {
        assert!(matches!(
            validate_archive_limits(&[(MAX_FILE_UNCOMPRESSED_SIZE + 1, 1)]),
            Err(LoadError::FileTooLarge(_))
        ));
        assert!(matches!(
            validate_archive_limits(&[
                (MAX_FILE_UNCOMPRESSED_SIZE, MAX_FILE_UNCOMPRESSED_SIZE),
                (MAX_FILE_UNCOMPRESSED_SIZE, MAX_FILE_UNCOMPRESSED_SIZE),
                (MAX_FILE_UNCOMPRESSED_SIZE, MAX_FILE_UNCOMPRESSED_SIZE),
                (MAX_FILE_UNCOMPRESSED_SIZE, MAX_FILE_UNCOMPRESSED_SIZE),
                (1, 1),
            ]),
            Err(LoadError::ArchiveTooLarge(_))
        ));
    }

    #[test]
    fn rejects_suspicious_compression_ratios() {
        assert!(matches!(
            validate_archive_limits(&[(MIN_RATIO_CHECK_SIZE, MIN_RATIO_CHECK_SIZE / (MAX_COMPRESSION_RATIO + 1))]),
            Err(LoadError::SuspiciousCompressionRatio)
        ));
    }
}
