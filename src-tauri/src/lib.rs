pub mod ai;
pub mod atomic_save;
pub mod commands;
pub mod folder_document;
pub mod folder_watcher;
mod history_maintenance;
mod history_transfer;
#[cfg(target_os = "macos")]
mod macos_menu;
#[cfg(target_os = "macos")]
mod macos_print;
pub mod manifest;
pub mod package_file;
pub mod package_loader;
pub mod package_validation;
pub mod package_writer;
mod saved_history;
pub mod path_validator;
mod print_monitor;
#[cfg(windows)]
mod windows_drop;
#[cfg(windows)]
mod windows_webview;

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
    #[cfg(target_os = "macos")]
    let builder = builder.menu(macos_menu::build);
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

    #[cfg(windows)]
    let builder = builder
        .manage(print_monitor::PrintMonitor::default())
        .manage(windows_drop::ImageDropState::default());

    builder
        .manage(folder_watcher::FolderWatcherState::default())
        .manage(history_transfer::HistoryUpload::default())
        .setup(|app| {
            use tauri::Manager;
            if let Ok(database) = commands::history_database(app.handle()) {
                app.manage(history_maintenance::HistoryMaintenance::start(database));
            }
            #[cfg(desktop)]
            {
                use tauri_plugin_window_state::WindowExt;

                #[cfg(windows)]
                windows_webview::create_main(app)?;

                if let Some(window) = app.get_webview_window("main") {
                    window.restore_state(window_state_flags())?;
                    #[cfg(windows)]
                    windows_drop::install(&window)?;
                }
            }
            Ok(())
        })
        .manage(ai::commands::AiStreamState {
            registry: std::sync::Arc::new(ai::cancel::CancellationRegistry::new()),
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            commands::open_package,
            commands::open_folder,
            commands::create_empty_folder,
            commands::save_package,
            commands::save_folder,
            commands::clear_saved_edit_history,
            commands::list_saved_edit_histories,
            commands::delete_saved_edit_history,
            history_transfer::begin_edit_history_upload,
            history_transfer::upload_edit_history_chunk,
            history_transfer::discard_edit_history_upload,
            history_transfer::read_edit_history_chunk,
            commands::export_package,
            commands::create_new_package,
            commands::import_folder,
            commands::export_folder,
            commands::read_attachment,
            commands::read_image,
            commands::save_attachment,
            commands::set_image_drop_enabled,
            #[cfg(target_os = "macos")]
            macos_print::print_prepared_pages,
            print_monitor::watch_print,
            print_monitor::close_print_preview,
            folder_watcher::watch_folder,
            folder_watcher::stop_watching_folder,
            commands::save_ai_config,
            commands::load_ai_config,
            commands::has_ai_configuration,
            commands::list_ai_models,
            commands::test_ai_connection,
            commands::ai_stream,
            commands::ai_selection_action,
            commands::ai_document_chat,
            commands::ai_edit_diagram,
            commands::cancel_ai_request,
        ])
        .run({
            let context = tauri::generate_context!();
            #[cfg(windows)]
            let context = windows_webview::configure(context);
            context
        })
        .expect("error while running tauri application");
}
