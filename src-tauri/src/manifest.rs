use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Resource {
    pub source: String,
    pub rendered: String,
    #[serde(rename = "type")]
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    pub format: String,
    pub version: String,
    pub entrypoint: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub resources: Vec<Resource>,
    #[serde(flatten)]
    pub unknown: std::collections::BTreeMap<String, Value>,
}

impl Manifest {
    pub fn parse(json: &str) -> Result<Self, ManifestError> {
        let value: Value = serde_json::from_str(json).map_err(ManifestError::InvalidJson)?;
        let mut manifest: Manifest =
            serde_json::from_value(value.clone()).map_err(ManifestError::InvalidJson)?;

        // 未知フィールドを保持する
        if let Some(obj) = value.as_object() {
            for (key, val) in obj {
                if !matches!(key.as_str(), "format" | "version" | "entrypoint" | "title" | "resources") {
                    manifest.unknown.insert(key.clone(), val.clone());
                }
            }
        }
        Ok(manifest)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ManifestError {
    #[error("manifest.json is not valid JSON: {0}")]
    InvalidJson(#[from] serde_json::Error),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_format() {
        let json = r#"{ "format": "mdpkg", "version": "1.0", "entrypoint": "README.md", "title": "Example" }"#;
        let manifest = Manifest::parse(json).unwrap();
        assert_eq!(manifest.format, "mdpkg");
    }

    #[test]
    fn parses_version() {
        let json = r#"{ "format": "mdpkg", "version": "1.0", "entrypoint": "README.md", "title": "Example" }"#;
        let manifest = Manifest::parse(json).unwrap();
        assert_eq!(manifest.version, "1.0");
    }

    #[test]
    fn parses_entrypoint() {
        let json = r#"{ "format": "mdpkg", "version": "1.0", "entrypoint": "README.md", "title": "Example" }"#;
        let manifest = Manifest::parse(json).unwrap();
        assert_eq!(manifest.entrypoint, "README.md");
    }

    #[test]
    fn parses_resources() {
        let json = r#"{
            "format": "mdpkg",
            "version": "1.0",
            "entrypoint": "README.md",
            "title": "Example",
            "resources": [
                { "source": "diagrams/a.puml", "rendered": "diagrams/a.svg", "type": "plantuml" }
            ]
        }"#;
        let manifest = Manifest::parse(json).unwrap();
        assert_eq!(manifest.resources.len(), 1);
        assert_eq!(manifest.resources[0].source, "diagrams/a.puml");
        assert_eq!(manifest.resources[0].rendered, "diagrams/a.svg");
        assert_eq!(manifest.resources[0].kind, "plantuml");
    }

    #[test]
    fn preserves_unknown_fields() {
        let json = r#"{ "format": "mdpkg", "version": "1.0", "entrypoint": "README.md", "title": "Example", "customField": 42 }"#;
        let manifest = Manifest::parse(json).unwrap();
        assert_eq!(manifest.unknown.get("customField").unwrap().as_i64(), Some(42));
    }

    #[test]
    fn rejects_invalid_json() {
        let result = Manifest::parse("not json");
        assert!(result.is_err());
    }
}
