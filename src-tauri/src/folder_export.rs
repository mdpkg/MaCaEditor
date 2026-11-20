use std::fs;
use std::path::Path;

use crate::package_loader::LoadedPackage;

/// Build the complete export next to the destination. Never merge into existing content.
pub(crate) fn export(loaded: &LoadedPackage, destination: &Path) -> Result<(), String> {
    let parent = destination
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let parent = fs::canonicalize(parent).map_err(|e| e.to_string())?;
    let name = destination.file_name().ok_or("invalid export folder")?;
    let destination = parent.join(name);
    let existed = match fs::symlink_metadata(&destination) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err("export destination must be an empty folder".into());
            }
            if fs::read_dir(&destination)
                .map_err(|e| e.to_string())?
                .next()
                .is_some()
            {
                return Err("export destination must be an empty folder".into());
            }
            true
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => false,
        Err(e) => return Err(e.to_string()),
    };
    let stage = parent.join(format!(".maca-export-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&stage).map_err(|e| e.to_string())?;
    let result = (|| {
        // LoadedPackage can also originate outside the ZIP loader.
        crate::folder_document::validate_document(&loaded.manifest, &loaded.files)
            .map_err(|e| e.to_string())?;
        for file in &loaded.files {
            let target = stage.join(file.path.replace('\\', "/"));
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            crate::atomic_save::atomic_save(&target, &file.content).map_err(|e| e.to_string())?;
        }
        let manifest = serde_json::to_vec_pretty(&loaded.manifest).map_err(|e| e.to_string())?;
        crate::atomic_save::atomic_save(&stage.join("manifest.json"), &manifest)
            .map_err(|e| e.to_string())?;
        if existed {
            // Fails without modifying anything if another process populated the folder.
            fs::remove_dir(&destination).map_err(|e| e.to_string())?;
        }
        if let Err(error) = fs::rename(&stage, &destination) {
            if existed {
                let _ = fs::create_dir(&destination);
            }
            return Err(error.to_string());
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&stage);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{manifest::Manifest, package_file::PackageFile};

    #[test]
    fn refuses_existing_content_and_leaves_no_partial_export_after_failure() {
        let root = std::env::temp_dir().join(format!("maca-export-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let dest = root.join("destination");
        fs::create_dir(&dest).unwrap();
        fs::write(dest.join("keep.md"), b"keep").unwrap();
        let mut loaded = LoadedPackage {
            manifest: Manifest::parse(
                r#"{"format":"mdpkg","version":"2.0","entrypoint":"index.md"}"#,
            )
            .unwrap(),
            files: vec![PackageFile::new_text("index.md".into(), "# Index".into())],
        };
        assert!(export(&loaded, &dest).is_err());
        assert_eq!(fs::read(dest.join("keep.md")).unwrap(), b"keep");
        fs::remove_file(dest.join("keep.md")).unwrap();
        // A file used as a parent makes staging fail after an earlier write.
        loaded.files.push(PackageFile::new_text(
            "index.md/child.txt".into(),
            "child".into(),
        ));
        assert!(export(&loaded, &dest).is_err());
        assert_eq!(fs::read_dir(&dest).unwrap().count(), 0);
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        loaded.files.pop();
        export(&loaded, &dest).unwrap();
        assert_eq!(fs::read(dest.join("index.md")).unwrap(), b"# Index");
        assert!(dest.join("manifest.json").is_file());
        fs::remove_dir_all(root).unwrap();
    }
}
