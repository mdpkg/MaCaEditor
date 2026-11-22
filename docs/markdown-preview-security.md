# Markdown preview URL and SVG reference policy

## Scope and behavior

Markdown link destinations now pass react-markdown 10.1.0's default URL transform
and one application resolver (`src/lib/previewUrl.ts`). The resolver accepts
explicit HTTP, HTTPS and mailto links, same-document fragments and package paths.
Package paths are split from queries/fragments, decoded once, checked for control
characters, ambiguous escapes and traversal, then resolved and encoded for DOM
use. File lookup uses the resolved path directly; consumers do not decode or
resolve it again. Images and legacy image destinations share this policy.
External links retain their existing browser navigation behavior.

SVG rendering uses `sanitizeHtml()` for the display copy, including the same
sanitized copy in the enlarged view. All SVG elements' href, xlink:href and src
attributes admit only conservative local fragments. Embedded base64 PNG, JPEG,
GIF, WebP and BMP data remains permitted on image href attributes, preserving
drawing-core images. SVG/HTML data URLs and external or relative file references
are removed. Presentation attributes and inline styles are checked for CSS
resource references and unsupported functions as well as style attributes.
Stylesheet rules are still limited to local presentation properties before the
stylesheet is discarded. Scripts, event handlers and foreignObject remain
prohibited. SVG links to external documents are intentionally removed; regular
Markdown and HTML sanitizer links retain their existing allowed behavior.

Local gradient, pattern, clipPath, mask, filter, marker, use and anchor references
are retained. Unsupported CSS functions, CSS variables, escaped CSS and unusual
fragment identifiers are rejected conservatively. Residual encoded escapes in
package filenames are rejected; ordinary Unicode, spaces and a literal percent
sign remain supported. Source SVG contents are never rewritten.

Package and folder loaders both classify SVG as text and provide the same
FileInfo representation to MarkdownPreview. Other inline diagram editors use
the same sanitizer. Marp's existing resource conversion, raster validation,
sandbox and CSP remain in place; no Marp architecture, global CSP or IPC model
changes are included.

## TDD and validation (2026-11-23)

- Red: `1750c70`, `6cbf66c`, `87a905e`. Before implementation, component tests
  rejected five reported URL normalization bypasses and failed against existing
  code. Chromium clicks confirmed execution for all five and additional encoded
  variants. A loopback-only server observed SVG image, xlink image and filter
  requests. An actual SVG anchor click navigated to its loopback destination.
- Green: `28dff33`, `5ebd350`. URL resolution is performed once and SVG references
  are restricted. The existing SVG external-link expectation was deliberately
  updated for the new policy, with allowed ordinary HTML links checked separately.
- Refactoring: `fc6a3a1`, `37c5de5`. Image/link URL handling and named SVG reference
  policy share implementations; additional unit cases cover decoding boundaries,
  embedded data, presentation attributes, CSS string resource functions and SMIL.
- Browser CI: `c9bb1b2`. `npm run test:browser` now runs the new real
  MarkdownPreview fixture alongside the existing image sizing, sanitizer and Marp
  tests. It checks DOM hrefs, browser protocols, actual clicks, loopback requests,
  SVG enlargement, source immutability and normal link/image/download callbacks.
  The test server listens only on 127.0.0.1; browser routes block other origins.
- Full unit/component suite: 91 files, 915 tests passed.
- Browser suite: 18 tests passed; unsafe links did not execute, SVG requests were
  zero and SVG anchors did not navigate. Existing Marp tests passed.
- `npm run build`: TypeScript and Vite passed (existing chunk-size warnings).
- `npm run check:architecture`: passed.
- `cargo test --locked --manifest-path src-tauri/Cargo.toml --lib` on Windows:
  227 tests passed.

Local unit execution used the existing locked dependencies with a temporary
Vite filesystem allowlist because the isolated checkout shared node_modules.
CI installs dependencies with npm ci and uses the normal test configuration.
No dependencies or lockfiles were changed.

## Native Windows / WebView2 verification (2026-11-23)

The original native probe failed before application initialization with
`0xC0000139` (`STATUS_ENTRYPOINT_NOT_FOUND`). This was a standalone test-wrapper
build issue: the final executable had no Windows application manifest. Its
imports included `TaskDialogIndirect`, but the default System32 `comctl32.dll`
did not export that function. [TaskDialogIndirect requires Common Controls
v6](https://learn.microsoft.com/en-us/windows/win32/api/commctrl/nf-commctrl-taskdialogindirect).
Adding the Common Controls v6 dependency manifest alone enabled startup.
The retained probe's own `build.rs` now embeds `app.manifest` in the final
executable, since the product dependency's `tauri-build` resource arguments do
not supply a manifest for a separate wrapper crate. A fresh source rebuild was
also verified, without DLL replacement, runtime reinstallation or registry edits.
The normal product already has its own `tauri_build::build()` step.

Native verification against main `bd5fca1507b5ee53dda4f8cf3d82fa0f9c2e85b2`
passed on Windows with **WebView2 157.0.4341.60**. A disposable app identifier and
synthetic documents were used; no real user documents or credentials were read.

| Check | Folder | mdpkg |
| --- | --- | --- |
| 13 dangerous link variants, including all five reported bypasses and plain JavaScript | No execution | No execution |
| SVG href/xlink:href/src, image/use/feImage, CSS URLs/string functions/imports/fonts and foreignObject | 0 HTTP requests | 0 HTTP requests |
| SVG external/script link clicks | No navigation or script execution | No navigation or script execution |
| Normal and enlarged SVG | Nonlocal URLs absent from DOM; local references retained | Nonlocal URLs absent from DOM; local references retained |
| Gradient, pattern, clip, mask, filter, marker and use references | Retained | Retained |
| Internal Markdown navigation | Passed | Passed |

A positive loopback fetch succeeded before the tests, showing that zero SVG
requests were not caused by an unavailable test server or a blanket network
block. Source SVG text and the mdpkg archive hash were unchanged after testing.

### Repeating the native check

Prerequisites: Windows, WebView2 Runtime, Node.js 22 or later, `npm ci`, Rust's
MSVC toolchain, Visual Studio C++ build tools and Windows SDK. Python and a
separate Playwright Chromium download are not required for this native check.
From the repository root:

```powershell
npm run test:webview2
# With cached Rust dependencies or a separate artifact/build location:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-markdown-webview2.ps1 -Offline -OutputRoot C:/temp/maca-native-results -CargoTargetDir C:/temp/maca-native-target
```

The runner builds the current checkout's frontend and a separate wrapper using
the actual product library. It seeds the disposable probe lockfile from
`src-tauri/Cargo.lock`, adding the wrapper without editing the product manifest
or lockfile. It gives every run a fresh app identifier, output directory and
loopback debugging port. It forces a new WebView2 profile inside that run's
output directory and checks the runtime app identifier before accessing storage.
The script temporarily sets build/test environment variables and restores them
on exit. Run one check at a time when sharing the same Cargo target directory.

`tests/native/markdown-security.mjs` creates only synthetic folder/ZIP fixtures,
uses a server bound to 127.0.0.1 and drives the native WebView through Playwright
CDP. The SVG anchor checks stop propagation to isolate navigation from the
parent enlargement handler; they do not cancel the anchor's default action.
Only the process started by the runner is terminated on success or failure.
The retained artifacts include `native-result.json` (runtime, binary hash and
assertions), normal fixture files, enlarged-view screenshots, the native log,
the disposable probe crate and browser profile. Native assertions/startup
failures after launch produce `native-failure.json`; build/setup failures are
reported by the runner. Default output is `output/native-markdown-security/<run>`;
outputs are ignored by Git and are retained for inspection, not auto-deleted.

This native check is opt-in; the regular CI path continues to run the mandatory
Chromium security regression suite through `npm run test:browser`. Regular CI
does not launch this native probe or require a graphical WebView2 test session.

## Limits and separate follow-up

Native rendering, link clicks, SVG network behavior and enlargement have now
been tested; the earlier native-rendering limitation is resolved. An
XSS-to-IPC exploit chain and arbitrary privileged IPC operations were **not**
executed. The tests use harmless JavaScript markers and do not access real
credentials or user files. The investigation's global CSP and broad IPC scoping
concerns remain separate follow-up work, outside these two targeted fixes.
