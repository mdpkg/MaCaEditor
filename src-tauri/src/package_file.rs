#[derive(Debug, Clone)]
pub enum FileKind {
    Text,
    Binary,
}

#[derive(Debug, Clone)]
pub struct PackageFile {
    pub path: String,
    pub kind: FileKind,
    pub content: Vec<u8>,
    pub modified: bool,
}

impl PackageFile {
    pub fn new_text(path: String, content: String) -> Self {
        Self {
            path,
            kind: FileKind::Text,
            content: content.into_bytes(),
            modified: false,
        }
    }

    pub fn new_binary(path: String, content: Vec<u8>) -> Self {
        Self {
            path,
            kind: FileKind::Binary,
            content,
            modified: false,
        }
    }

    pub fn is_text(&self) -> bool {
        matches!(self.kind, FileKind::Text)
    }

    pub fn text_content(&self) -> Option<&str> {
        if self.is_text() {
            std::str::from_utf8(&self.content).ok()
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_text_file() {
        let file = PackageFile::new_text("README.md".to_string(), "# Hello".to_string());
        assert!(file.is_text());
        assert_eq!(file.text_content(), Some("# Hello"));
    }

    #[test]
    fn creates_binary_file() {
        let file = PackageFile::new_binary("images/a.png".to_string(), vec![1, 2, 3]);
        assert!(!file.is_text());
        assert_eq!(file.text_content(), None);
    }

    #[test]
    fn tracks_modified_state() {
        let mut file = PackageFile::new_text("README.md".to_string(), "# Hello".to_string());
        assert!(!file.modified);
        file.modified = true;
        assert!(file.modified);
    }
}
