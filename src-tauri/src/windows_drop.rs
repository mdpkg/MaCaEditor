use std::{
    cell::Cell,
    ffi::OsString,
    os::windows::ffi::OsStringExt,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};
use tauri::{AppHandle, Emitter, EventTarget, Manager, WebviewWindow};
use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller4;
use windows::{
    core::{implement, Interface, Ref, Result, BOOL},
    Win32::{
        Foundation::{DRAGDROP_E_INVALIDHWND, E_FAIL, HWND, LPARAM, LRESULT, POINTL, WPARAM},
        System::{
            Com::{IDataObject, DVASPECT_CONTENT, FORMATETC, TYMED_HGLOBAL},
            Ole::{
                IDropTarget, IDropTarget_Impl, RegisterDragDrop, ReleaseStgMedium, RevokeDragDrop,
                CF_HDROP, DROPEFFECT, DROPEFFECT_COPY, DROPEFFECT_NONE,
            },
            SystemServices::MODIFIERKEYS_FLAGS,
        },
        UI::{
            Shell::{
                DefSubclassProc, DragQueryFileW, RemoveWindowSubclass, SetWindowSubclass, HDROP,
            },
            WindowsAndMessaging::{EnumChildWindows, IsChild, WM_DESTROY},
        },
    },
};

use crate::image_formats::supported_image_extension;

#[derive(Default)]
pub struct ImageDropState(AtomicBool);

pub fn set_images_enabled(app: &AppHandle, enabled: bool) {
    app.state::<ImageDropState>()
        .0
        .store(enabled, Ordering::Relaxed);
}

pub fn install(window: &WebviewWindow) -> tauri::Result<()> {
    let app = window.app_handle().clone();
    window.with_webview(move |webview| {
        let result = unsafe {
            let controller = webview.controller();
            let mut parent = HWND::default();
            controller.ParentWindow(&mut parent).and_then(|()| {
                controller
                    .cast::<ICoreWebView2Controller4>()?
                    .SetAllowExternalDrop(false)?;
                register_in_webview(parent, app)
            })
        };
        if let Err(error) = result {
            eprintln!("failed to install the Windows file drop target: {error}");
        }
    })
}

unsafe fn register_in_webview(parent: HWND, app: AppHandle) -> Result<()> {
    let mut children = Vec::new();
    let _ = EnumChildWindows(
        Some(parent),
        Some(collect_child),
        LPARAM(&mut children as *mut Vec<HWND> as isize),
    );
    let mut registrations = Box::new(DropRegistrations {
        parent,
        children: Vec::new(),
    });
    // WebView2 routes external drags through Chromium's child windows, including
    // HWNDs owned by its renderer processes. Register on the same HWNDs as Wry.
    for child in children {
        if RevokeDragDrop(child) != Err(DRAGDROP_E_INVALIDHWND.into())
            && register(child, app.clone()).is_ok()
        {
            registrations.children.push(child);
        }
    }
    if registrations.children.is_empty() {
        register(parent, app)?;
        registrations.children.push(parent);
    }
    let registrations = Box::into_raw(registrations);
    if !SetWindowSubclass(parent, Some(cleanup_targets), 0, registrations as usize).as_bool() {
        drop(Box::from_raw(registrations));
        return Err(windows::core::Error::new(
            E_FAIL,
            "Could not track the WebView2 drop targets",
        ));
    }
    Ok(())
}

unsafe extern "system" fn collect_child(hwnd: HWND, context: LPARAM) -> BOOL {
    (&mut *(context.0 as *mut Vec<HWND>)).push(hwnd);
    true.into()
}

unsafe fn register(hwnd: HWND, app: AppHandle) -> Result<()> {
    let target: IDropTarget = FileDropTarget {
        app,
        accepted: Cell::new(false),
    }
    .into();
    RegisterDragDrop(hwnd, &target)
}

struct DropRegistrations {
    parent: HWND,
    children: Vec<HWND>,
}

impl Drop for DropRegistrations {
    fn drop(&mut self) {
        for &hwnd in &self.children {
            unsafe {
                if hwnd == self.parent || IsChild(self.parent, hwnd).as_bool() {
                    let _ = RevokeDragDrop(hwnd);
                }
            }
        }
    }
}

unsafe extern "system" fn cleanup_targets(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    id: usize,
    data: usize,
) -> LRESULT {
    if message == WM_DESTROY {
        let _ = RemoveWindowSubclass(hwnd, Some(cleanup_targets), id);
        drop(Box::from_raw(data as *mut DropRegistrations));
    }
    DefSubclassProc(hwnd, message, wparam, lparam)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
enum DropAction {
    Folder,
    Package,
    Images,
}

#[derive(Clone, serde::Serialize)]
struct FileDrop {
    action: DropAction,
    paths: Vec<PathBuf>,
}

fn drop_action(paths: &[PathBuf], images_enabled: bool) -> Option<DropAction> {
    if let [path] = paths {
        if path.is_dir() {
            return Some(DropAction::Folder);
        }
        if extension(path).as_deref() == Some("mdpkg") {
            return Some(DropAction::Package);
        }
    }
    if images_enabled
        && paths.iter().any(|path| {
            extension(path).is_some_and(|ext| supported_image_extension(&ext)) && !path.is_dir()
        })
    {
        return Some(DropAction::Images);
    }
    None
}

fn extension(path: &Path) -> Option<String> {
    path.extension()?.to_str().map(str::to_ascii_lowercase)
}

fn drop_paths(data: Ref<'_, IDataObject>) -> Vec<PathBuf> {
    let Some(data) = data.as_ref() else {
        return Vec::new();
    };
    let format = FORMATETC {
        cfFormat: CF_HDROP.0,
        dwAspect: DVASPECT_CONTENT.0,
        lindex: -1,
        tymed: TYMED_HGLOBAL.0 as u32,
        ..Default::default()
    };
    // CF_HDROP is a list of paths. No file contents are read during hover.
    unsafe {
        let Ok(mut medium) = data.GetData(&format) else {
            return Vec::new();
        };
        let handle = HDROP(medium.u.hGlobal.0);
        let paths = (0..DragQueryFileW(handle, u32::MAX, None))
            .filter_map(|index| {
                let mut name = vec![0; DragQueryFileW(handle, index, None) as usize + 1];
                let len = DragQueryFileW(handle, index, Some(&mut name)) as usize;
                (len > 0).then(|| OsString::from_wide(&name[..len]).into())
            })
            .collect();
        ReleaseStgMedium(&mut medium);
        paths
    }
}

fn set_effect(effect: &mut DROPEFFECT, accepted: bool) -> bool {
    let copy = accepted && (*effect & DROPEFFECT_COPY) == DROPEFFECT_COPY;
    *effect = if copy {
        DROPEFFECT_COPY
    } else {
        DROPEFFECT_NONE
    };
    copy
}

#[implement(IDropTarget)]
struct FileDropTarget {
    app: AppHandle,
    accepted: Cell<bool>,
}

impl FileDropTarget {
    fn action(&self, paths: &[PathBuf]) -> Option<DropAction> {
        let images_enabled = self.app.state::<ImageDropState>().0.load(Ordering::Relaxed);
        drop_action(paths, images_enabled)
    }
}

#[allow(non_snake_case)]
impl IDropTarget_Impl for FileDropTarget_Impl {
    fn DragEnter(
        &self,
        data: Ref<'_, IDataObject>,
        _: MODIFIERKEYS_FLAGS,
        _: &POINTL,
        effect: *mut DROPEFFECT,
    ) -> Result<()> {
        let accepted = self.action(&drop_paths(data)).is_some();
        self.accepted.set(accepted);
        if let Some(effect) = unsafe { effect.as_mut() } {
            set_effect(effect, accepted);
        }
        Ok(())
    }

    fn DragOver(&self, _: MODIFIERKEYS_FLAGS, _: &POINTL, effect: *mut DROPEFFECT) -> Result<()> {
        if let Some(effect) = unsafe { effect.as_mut() } {
            set_effect(effect, self.accepted.get());
        }
        Ok(())
    }

    fn DragLeave(&self) -> Result<()> {
        self.accepted.set(false);
        Ok(())
    }

    fn Drop(
        &self,
        data: Ref<'_, IDataObject>,
        _: MODIFIERKEYS_FLAGS,
        _: &POINTL,
        effect: *mut DROPEFFECT,
    ) -> Result<()> {
        self.accepted.set(false);
        let Some(effect) = (unsafe { effect.as_mut() }) else {
            return Ok(());
        };
        let paths = drop_paths(data);
        let Some(action) = self.action(&paths) else {
            *effect = DROPEFFECT_NONE;
            return Ok(());
        };
        if !set_effect(effect, true) {
            return Ok(());
        }
        let payload = FileDrop { action, paths };
        if let Err(error) =
            self.app
                .emit_to(EventTarget::webview("main"), "maca://file-drop", payload)
        {
            *effect = DROPEFFECT_NONE;
            eprintln!("failed to deliver the Windows file drop: {error}");
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::System::Ole::DROPEFFECT_MOVE;

    #[test]
    fn accepts_a_folder_or_package_and_imports_images_only_with_a_document() {
        let folder = std::env::temp_dir().join(format!("maca-drop-{}.png", uuid::Uuid::new_v4()));
        std::fs::create_dir(&folder).unwrap();
        let folder_action = drop_action(&[folder.clone()], false);
        std::fs::remove_dir(&folder).unwrap();
        assert_eq!(folder_action, Some(DropAction::Folder));

        let file = |name| PathBuf::from(name);
        assert_eq!(
            drop_action(&[file("one.MDPKG")], false),
            Some(DropAction::Package)
        );
        assert_eq!(
            drop_action(&[file("one.mdpkg"), file("two.mdpkg")], true),
            None
        );
        assert_eq!(drop_action(&[file("photo.PNG")], false), None);
        assert_eq!(
            drop_action(&[file("photo.PNG"), file("note.txt")], true),
            Some(DropAction::Images)
        );
        assert_eq!(
            drop_action(&[file("note.txt"), file("unsupported.svg")], true),
            None
        );
    }

    #[test]
    fn reports_only_copy_or_none_to_the_drag_source() {
        let mut effect = DROPEFFECT_COPY | DROPEFFECT_MOVE;
        assert!(set_effect(&mut effect, true));
        assert_eq!(effect, DROPEFFECT_COPY);
        assert!(!set_effect(&mut effect, false));
        assert_eq!(effect, DROPEFFECT_NONE);

        let mut move_only = DROPEFFECT_MOVE;
        assert!(!set_effect(&mut move_only, true));
        assert_eq!(move_only, DROPEFFECT_NONE);
    }
}
