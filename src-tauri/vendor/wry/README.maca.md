# MaCa Editor WebView2 frame isolation patch

Source: published `wry` 0.55.1 (MIT OR Apache-2.0), matching Cargo.lock.
Published source/licenses are retained; Cargo cache metadata and the dependency
lockfile are omitted. Only `src/webview2/mod.rs` differs from upstream code:

1. Honor `InitializationScript.for_main_frame_only` with a `window === window.top`
   guard. WebView2 otherwise runs main-only scripts even in opaque sandboxed
   frames, exposing Tauri initialization, metadata and invocation machinery.
2. Define Wry's native `window.ipc` bridge only in the top frame.

Explicitly all-frame scripts and other OS implementations are unchanged. This
is not a custom renderer or IPC stack. A failure was reproduced on real Windows
WebView2 first. `tests/browser/marp-webview2.mjs` verifies real Rust package IO
in the main app and absence of `__TAURI_INTERNALS__`/`ipc` in the preview. Keep
this native test on upgrades. Remove the patch when upstream supplies equivalent
frame isolation.
