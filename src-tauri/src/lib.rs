pub mod atomic_save;
pub mod commands;
pub mod manifest;
pub mod package_file;
pub mod package_loader;
pub mod package_validation;
pub mod package_writer;
pub mod path_validator;

#[cfg(desktop)]
fn window_state_flags() -> tauri_plugin_window_state::StateFlags {
    tauri_plugin_window_state::StateFlags::POSITION
        | tauri_plugin_window_state::StateFlags::SIZE
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder = builder.plugin(
        tauri_plugin_window_state::Builder::default()
            .with_state_flags(window_state_flags())
            .skip_initial_state("main")
            .build(),
    );

    builder
        .setup(|app| {
            #[cfg(desktop)]
            {
                use tauri::Manager;
                use tauri_plugin_window_state::WindowExt;

                if let Some(window) = app.get_webview_window("main") {
                    window.restore_state(window_state_flags())?;
                    window.show()?;
                }
            }
            Ok(())
        })
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
