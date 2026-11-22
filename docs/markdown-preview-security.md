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

## Limits and separate follow-up

The rendering and click checks above use Playwright Chromium. The complete
Tauri/WebView2 interaction and XSS-to-IPC chain have not been tested in a fresh
native application instance. No real user documents, credentials or external
test endpoints were used. The investigation's global CSP and broad IPC scoping
concerns remain separate follow-up work, outside these two targeted fixes.
