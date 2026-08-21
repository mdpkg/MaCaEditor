pub mod atomic_save;
pub mod commands;
pub mod manifest;
pub mod package_file;
pub mod package_loader;
pub mod package_validation;
pub mod package_writer;
pub mod path_validator;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder = builder.plugin(
        tauri_plugin_window_state::Builder::default()
            .with_state_flags(
                tauri_plugin_window_state::StateFlags::POSITION
                    | tauri_plugin_window_state::StateFlags::SIZE,
            )
            .build(),
    );

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            commands::open_package,
            commands::save_package,
            commands::create_new_package,
            commands::import_folder,
            commands::export_folder,
            commands::read_image,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
