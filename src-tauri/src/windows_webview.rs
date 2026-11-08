use std::{path::Path, sync::mpsc};

use tauri::{Manager, WebviewWindowBuilder};
use webview2_com::{
    CoreWebView2EnvironmentOptions, CreateCoreWebView2EnvironmentCompletedHandler,
    Microsoft::Web::WebView2::Win32::{
        CreateCoreWebView2EnvironmentWithOptions, ICoreWebView2Environment,
        ICoreWebView2EnvironmentOptions,
    },
};
use windows::{
    core::{HSTRING, PCWSTR},
    Win32::{
        Foundation::{E_POINTER, E_UNEXPECTED},
        System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED},
    },
};

pub fn configure(mut context: tauri::Context<tauri::Wry>) -> tauri::Context<tauri::Wry> {
    if let Some(main) = context
        .config_mut()
        .app
        .windows
        .iter_mut()
        .find(|window| window.label == "main")
    {
        main.create = false;
        // Wry accepts every CF_HDROP with DROPEFFECT_COPY. Install our own drop target.
        main.drag_drop_enabled = false;
    }
    context
}

pub fn create_main(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .ok_or("missing main window configuration")?;
    // This runs before Wry creates a webview and initializes COM on this thread.
    unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()? };
    let _com = ComApartment;
    let data_dir = app.path().app_local_data_dir()?;
    let environment = japanese_environment(&data_dir)?;
    WebviewWindowBuilder::from_config(app, config)?
        .with_environment(environment)
        .build()?;
    Ok(())
}

struct ComApartment;

impl Drop for ComApartment {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

fn japanese_environment(data_dir: &Path) -> webview2_com::Result<ICoreWebView2Environment> {
    let (send, receive) = mpsc::channel();
    let options = CoreWebView2EnvironmentOptions::default();
    // A supplied environment replaces Wry's defaults, including these browser options.
    unsafe {
        options.set_additional_browser_arguments(
            "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required".into(),
        );
        options.set_language("ja-JP".into());
        CreateCoreWebView2EnvironmentWithOptions(
            PCWSTR::null(),
            &HSTRING::from(data_dir),
            &ICoreWebView2EnvironmentOptions::from(options),
            &CreateCoreWebView2EnvironmentCompletedHandler::create(Box::new(
                move |result, environment| {
                    let result = result.and_then(|()| environment.ok_or(E_POINTER.into()));
                    send.send(result).map_err(|_| E_UNEXPECTED.into())
                },
            )),
        )?;
    }
    Ok(webview2_com::wait_with_pump(receive)??)
}
