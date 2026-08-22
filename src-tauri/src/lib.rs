pub mod atomic_save;
pub mod commands;
pub mod manifest;
pub mod package_file;
pub mod package_loader;
pub mod package_validation;
pub mod package_writer;
pub mod path_validator;

#[cfg(all(test, desktop))]
mod startup_visibility_tests {
    use super::should_show_main_window;
    use tauri::webview::PageLoadEvent;

    #[test]
    fn shows_main_window_only_after_its_page_finishes_loading() {
        assert!(!should_show_main_window("main", PageLoadEvent::Started));
        assert!(should_show_main_window("main", PageLoadEvent::Finished));
        assert!(!should_show_main_window(
            "secondary",
            PageLoadEvent::Finished
        ));
    }
}

#[cfg(desktop)]
fn window_state_flags() -> tauri_plugin_window_state::StateFlags {
    tauri_plugin_window_state::StateFlags::POSITION | tauri_plugin_window_state::StateFlags::SIZE
}

#[cfg(desktop)]
fn should_show_main_window(label: &str, event: tauri::webview::PageLoadEvent) -> bool {
    label == "main" && event == tauri::webview::PageLoadEvent::Finished
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
    #[cfg(desktop)]
    let builder = builder.on_page_load(|webview, payload| {
        if should_show_main_window(webview.label(), payload.event()) {
            if let Err(error) = webview.window().show() {
                eprintln!("failed to show the main window: {error}");
            }
        }
    });

    builder
        .setup(|app| {
            #[cfg(desktop)]
            {
                use tauri::Manager;
                use tauri_plugin_window_state::WindowExt;

                if let Some(window) = app.get_webview_window("main") {
                    window.restore_state(window_state_flags())?;
                }
            }
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            commands::open_package,
            commands::save_package,
            commands::create_new_package,
            commands::import_folder,
            commands::export_folder,
            commands::read_attachment,
            commands::read_image,
            commands::save_attachment,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
