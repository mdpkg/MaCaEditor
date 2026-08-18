use crate::manifest::Manifest;
use crate::path_validator::{validate_package_path, PathError};

#[derive(Debug, thiserror::Error)]
pub enum ValidationError {
    #[error("format must be \"mdpkg\"")]
    InvalidFormat,
    #[error("version is missing")]
    MissingVersion,
    #[error("entrypoint is missing")]
    MissingEntrypoint,
    #[error("entrypoint \"{0}\" does not exist in this package")]
    EntrypointNotFound(String),
    #[error("entrypoint \"{0}\" escapes the package")]
    EntrypointEscapes(String),
    #[error("resource path \"{0}\" escapes the package")]
    ResourceEscapes(String),
}

/// manifest の必須フィールドを検証する。
pub fn validate_manifest(manifest: &Manifest) -> Result<(), ValidationError> {
    if manifest.format != "mdpkg" {
        return Err(ValidationError::InvalidFormat);
    }
    if manifest.version.is_empty() {
        return Err(ValidationError::MissingVersion);
    }
    if manifest.entrypoint.is_empty() {
        return Err(ValidationError::MissingEntrypoint);
    }
    Ok(())
}

/// entrypoint と resource のパスがパッケージ内に留まることを検証する。
pub fn validate_paths(manifest: &Manifest) -> Result<(), ValidationError> {
    validate_package_path(&manifest.entrypoint).map_err(|e| match e {
        PathError::OutsidePackage | PathError::InvalidSegment | PathError::Empty => {
            ValidationError::EntrypointEscapes(manifest.entrypoint.clone())
        }
    })?;
    for resource in &manifest.resources {
        validate_package_path(&resource.source).map_err(|_| {
            ValidationError::ResourceEscapes(resource.source.clone())
        })?;
        validate_package_path(&resource.rendered).map_err(|_| {
            ValidationError::ResourceEscapes(resource.rendered.clone())
        })?;
    }
    Ok(())
}

/// entrypoint がパッケージ内に存在することを検証する。
pub fn validate_entrypoint_exists(
    manifest: &Manifest,
    files: &[String],
) -> Result<(), ValidationError> {
    let normalized = manifest.entrypoint.replace('\\', "/");
    let exists = files
        .iter()
        .any(|f| f.replace('\\', "/") == normalized);
    if !exists {
        return Err(ValidationError::EntrypointNotFound(manifest.entrypoint.clone()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::Manifest;

    fn manifest(format: &str, version: &str, entrypoint: &str) -> Manifest {
        Manifest::parse(&format!(
            r#"{{ "format": "{format}", "version": "{version}", "entrypoint": "{entrypoint}", "title": "T" }}"#
        ))
        .unwrap()
    }

    #[test]
    fn accepts_valid_manifest() {
        let m = manifest("mdpkg", "1.0", "README.md");
        assert!(validate_manifest(&m).is_ok());
    }

    #[test]
    fn rejects_wrong_format() {
        let m = manifest("other", "1.0", "README.md");
        assert!(matches!(
            validate_manifest(&m),
            Err(ValidationError::InvalidFormat)
        ));
    }

    #[test]
    fn rejects_missing_version() {
        let m = manifest("mdpkg", "", "README.md");
        assert!(matches!(
            validate_manifest(&m),
            Err(ValidationError::MissingVersion)
        ));
    }

    #[test]
    fn rejects_missing_entrypoint() {
        let m = manifest("mdpkg", "1.0", "");
        assert!(matches!(
            validate_manifest(&m),
            Err(ValidationError::MissingEntrypoint)
        ));
    }

    #[test]
    fn rejects_entrypoint_escaping_package() {
        let m = manifest("mdpkg", "1.0", "../README.md");
        assert!(matches!(
            validate_paths(&m),
            Err(ValidationError::EntrypointEscapes(_))
        ));
    }

    #[test]
    fn rejects_resource_escaping_package() {
        let json = r#"{
            "format": "mdpkg",
            "version": "1.0",
            "entrypoint": "README.md",
            "title": "T",
            "resources": [
                { "source": "../../evil.puml", "rendered": "diagrams/a.svg", "type": "plantuml" }
            ]
        }"#;
        let m = Manifest::parse(json).unwrap();
        assert!(matches!(
            validate_paths(&m),
            Err(ValidationError::ResourceEscapes(_))
        ));
    }

    #[test]
    fn rejects_missing_entrypoint_file() {
        let m = manifest("mdpkg", "1.0", "README.md");
        let files = vec!["manifest.json".to_string()];
        assert!(matches!(
            validate_entrypoint_exists(&m, &files),
            Err(ValidationError::EntrypointNotFound(_))
        ));
    }

    #[test]
    fn accepts_existing_entrypoint_file() {
        let m = manifest("mdpkg", "1.0", "README.md");
        let files = vec!["README.md".to_string(), "manifest.json".to_string()];
        assert!(validate_entrypoint_exists(&m, &files).is_ok());
    }
}
