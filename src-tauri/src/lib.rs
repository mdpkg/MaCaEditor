pub mod manifest;
pub mod package_file;
pub mod package_loader;
pub mod package_validation;
pub mod path_validator;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
