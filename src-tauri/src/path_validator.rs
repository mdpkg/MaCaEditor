/// パッケージ内部のパスを検証する。
/// パッケージ外へ出るパス（path traversal）を拒否する。
pub fn validate_package_path(path: &str) -> Result<(), PathError> {
    if path.is_empty() {
        return Err(PathError::Empty);
    }

    // Windows ドライブレター（C:foo.txt）を拒否
    if path.len() >= 2 && path.as_bytes()[1] == b':' {
        return Err(PathError::OutsidePackage);
    }

    // 絶対パス（/foo.txt, \foo.txt）を拒否
    if path.starts_with('/') || path.starts_with('\\') {
        return Err(PathError::OutsidePackage);
    }

    // 区切り文字を正規化して各セグメントを検証
    let normalized = path.replace('\\', "/");
    for segment in normalized.split('/') {
        match segment {
            "" | "." => return Err(PathError::InvalidSegment),
            ".." => return Err(PathError::OutsidePackage),
            _ => {
                // Windows の ..evil.txt のようなすり抜けを防ぐ
                if segment.starts_with("..") {
                    return Err(PathError::OutsidePackage);
                }
            }
        }
    }

    Ok(())
}

#[derive(Debug, PartialEq, thiserror::Error)]
pub enum PathError {
    #[error("path is empty")]
    Empty,
    #[error("path contains an invalid segment")]
    InvalidSegment,
    #[error("path escapes the package")]
    OutsidePackage,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_safe_relative_path() {
        assert!(validate_package_path("README.md").is_ok());
        assert!(validate_package_path("diagrams/architecture.svg").is_ok());
    }

    #[test]
    fn rejects_parent_directory() {
        assert_eq!(
            validate_package_path("../evil.txt"),
            Err(PathError::OutsidePackage)
        );
        assert_eq!(
            validate_package_path("../../evil.txt"),
            Err(PathError::OutsidePackage)
        );
    }

    #[test]
    fn rejects_absolute_path() {
        assert_eq!(
            validate_package_path("/foo.txt"),
            Err(PathError::OutsidePackage)
        );
    }

    #[test]
    fn rejects_windows_drive_letter() {
        assert_eq!(
            validate_package_path("C:foo.txt"),
            Err(PathError::OutsidePackage)
        );
    }

    #[test]
    fn rejects_windows_dotdot_evasion() {
        assert_eq!(
            validate_package_path("..evil.txt"),
            Err(PathError::OutsidePackage)
        );
    }

    #[test]
    fn rejects_empty_path() {
        assert_eq!(validate_package_path(""), Err(PathError::Empty));
    }

    #[test]
    fn accepts_backslash_separated_path() {
        assert!(validate_package_path("diagrams\\architecture.svg").is_ok());
    }
}
