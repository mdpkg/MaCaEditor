# Tauri CSP and document IPC authorization

## Investigation and changes (2026-11-23)

The main WebView had no CSP. Custom document commands read and wrote caller
paths without consulting the native filesystem scope. Package creation,
import/export and recursive folder watching had the same omission. Frontend
recent-document paths were stored in localStorage and were not authorization.
A disposable native instance reproduced the issue: opening an unselected
synthetic mdpkg succeeded when the regression assertion required rejection.

Two additional permission paths mattered to closing this issue:

- `fs:default` includes application-data read scopes. A custom write command
  must not mistake those plugin read grants for permission to overwrite private
  state.
- `store:default` exposes generic load/save operations on caller-selected JSON
  paths. Leaving this interface available would bypass the custom command gates.

The main capability no longer grants either generic plugin permission set.
Editor preferences now use `read_editor_preferences` / `save_editor_preferences`
with the existing fixed AppData `settings.json` format. Existing unknown legacy
keys are retained when known settings are updated; only the four editor settings
are returned. The store plugin is not registered with the app. No dependency
versions or lockfiles were changed.

All custom path-bearing document commands now check a common Rust policy before
reading, writing, consuming a save upload, or installing a watcher. Files chosen
through native dialogs/drops are authorized by Tauri's native filesystem scope.
Relative paths, parent traversal, Windows device/ADS/ambiguous path segments and
unselected paths are rejected. Existing folder containment, symlink/junction,
validation and atomic-save checks remain in force.

Rust remembers at most 128 canonical file/folder identities in its own
`approved-documents.json` under AppLocalData, only after native scope approval.
Reopening an exact previously approved document after restart is allowed;
frontend recent entries cannot create approvals. Folder approvals do not give
generic read/write commands a persisted descendant or prefix grant. Explicit
scope denials take precedence. Replacing an approved path with a link to another
target does not approve that new canonical target. Corrupt or oversized approval
records fail closed, requiring native re-selection.

Application Data, Local Data and Config directories are protected from generic
document operations, including folder operations on their ancestors, so a
selected document cannot overwrite the approval ledger or other private state.
Opening a folder that contains those private directories (for example the
whole user home or volume root) is therefore rejected; choose the document's
own subtree instead.
Settings/history/AI configuration continue to use their own fixed-path Rust
operations. Native folder drops now grant the selected directory as well as
file drops, and folder pickers explicitly request recursive access.

## CSP and compatibility

Production CSP is configured in `src-tauri/tauri.conf.json`. It allows bundled
scripts/resources, IPC transport, data/blob images and the WebAssembly compilation
needed by the offline layout engine. It blocks arbitrary inline JavaScript,
JavaScript eval, non-self resource requests, external frames, object embedding,
base changes and form submissions. Inline styles remain necessary for the
editor, sanitized diagrams, Marp themes and printing. External link navigation
is unchanged; CSP resource restrictions are not a link-navigation policy.

Marp's srcdoc inherits the parent's CSP. Its fixed runtime is now retained as
`src/lib/marp/frameRuntime.js` with an explicit SHA-256 source hash in the main
CSP. The random session is validated and placed in an HTML data attribute,
not interpolated into executable code. The iframe still has its own nonce CSP
and opaque sandbox, and receives no Tauri/IPC initialization scripts.
`.gitattributes` fixes this runtime to UTF-8/LF; browser CI verifies the exact
hash. Updating the runtime requires updating the CSP hash as well. This avoids
enabling general inline script execution to make an inherited frame work.

`devCsp` separately permits Vite's inline refresh and localhost:1420 HMR WebSocket
connections. It does not enable JavaScript eval. These development permissions
are not added to production CSP.

| Feature | Effect / verification |
| --- | --- |
| Native open/save, Save As, create, import/export | Native selection required; new destinations are remembered after successful creation; authorized package/folder save and pure operation regression tests retained |
| Recent documents | Rust-approved canonical identities reopen after restart; legacy localStorage-only entries prompt for one native re-selection; cancel keeps the current view |
| Folder reload and watcher | Exact approved root required before loading or installing the watcher |
| Image/attachment import and download | Existing native file selection requirement retained; private application data is denied |
| Vim, TOC, Rspress, drawing settings | Existing `settings.json` format/path retained through fixed native commands; legacy-value preservation and native round-trip checked |
| Markdown, SVG, enlargement, internal links | Browser/native regression suites retained |
| Marp, MathJax and slide navigation | Parent CSP hash allows only the fixed helper; sandbox/IPC isolation retained |
| PlantUML wasm, Mermaid, standalone MathJax | Actual offline renderers exercised under production CSP |
| Print pagination | Bundled paginator runs in a same-origin inherited-CSP frame; page preparation tested without submitting a print job |
| AI providers | Rust-side provider requests are not governed by WebView connect-src; existing configurable providers remain supported |

## Verification and repeat commands

`npm run test:browser` includes `tests/browser/csp.mjs` in ordinary CI. It serves
the exact production policy as a response header, checks injection/network
denials, fixed helper hashing, development refresh, Marp isolation, all three
offline diagram renderers and print preparation. Asset scripts are served from
the same origin, matching a production app build rather than library-mode data
script inlining. The loopback sink is positively checked before negative tests.

The native command remains `npm run test:webview2`. It uses a new application
identifier and browser profile, synthetic folder/mdpkg documents and harmless
JavaScript markers. The runner seeds only its fresh test instance's Rust-owned
prior-selection record for those synthetic documents; it exposes no permission
grant command in the product. The controller verifies the loopback server;
fetch from the protected WebView must now be blocked. It also verifies denied
IPC calls, approved package/folder saves and watcher installation, unchanged unauthorized canaries, fixed-path preference persistence,
Markdown/SVG, enlargement, Marp math and slide navigation in folder/package modes.
This extends the native procedure in [the Markdown security record](markdown-preview-security.md).

Local evidence includes the unselected-file Red test, Rust authorization and
preference migration tests, frontend legacy-reselection/cancel tests, the CSP
Chromium suite and an isolated Windows/WebView2 157.0.4341.60 run. No real user
documents, credentials, external test services or actual print jobs are used.

## Boundaries

CSP is defense in depth, not a substitute for sanitizing document content.
The path policy authorizes native-selected or remembered documents; it is not
an inode-based security boundary against another process running as the same
OS user. Backend approval records cannot be changed through document/store IPC,
but an OS user who can modify application data already controls that state.
The native test seeds approvals rather than automating OS file dialogs; picker
scope propagation uses Tauri's existing dialog plugin. Other platforms' WebViews
and actual print dialogs are not exercised by the Windows native smoke test.
This change does not claim to prevent every privileged action by already
compromised trusted application code, or restrict Rust-side AI networking.

References: [Tauri CSP](https://v2.tauri.app/security/csp/),
[custom command scopes](https://v2.tauri.app/security/scope/), and
[native dialog scope behavior](https://v2.tauri.app/reference/javascript/dialog/).
