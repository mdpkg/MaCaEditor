[CmdletBinding()]
param(
    [string]$OutputRoot,
    [string]$CargoTargetDir,
    [switch]$Offline
)

$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Requires Windows, MSVC/Windows SDK and WebView2 Runtime.' }
$taskRepo = Split-Path -Parent $PSScriptRoot
if (-not $OutputRoot) { $OutputRoot = Join-Path $taskRepo 'output/native-markdown-security' }
if (-not $CargoTargetDir) { $CargoTargetDir = Join-Path $taskRepo 'src-tauri/target' }
$taskRunId = [Guid]::NewGuid().ToString('N')
$taskIdentifier = "com.maca.markdownsecurityprobe.run$taskRunId"
$taskOutput = [IO.Path]::GetFullPath((Join-Path $OutputRoot $taskRunId))
$taskProbe = Join-Path $taskOutput 'probe'
$taskEnvironmentNames = @('TAURI_CONFIG', 'CARGO_TARGET_DIR', 'MACA_NATIVE_TEST_ID', 'MACA_NATIVE_TEST_EXE', 'MACA_NATIVE_TEST_OUTPUT')
$taskPreviousEnvironment = @{}
foreach ($taskName in $taskEnvironmentNames) {
    $taskPreviousEnvironment[$taskName] = [Environment]::GetEnvironmentVariable($taskName, 'Process')
}

Push-Location $taskRepo
try {
    # Each run has a fresh app identifier: Tauri stores, history and WebView2 use
    # their own app data directories, never the normal com.maca.editor profile.
    New-Item -ItemType Directory -Path "$taskProbe/src" -Force | Out-Null
    Copy-Item -LiteralPath "$taskRepo/tests/native/markdown-security-probe/main.rs" -Destination "$taskProbe/src/main.rs"
    Copy-Item -LiteralPath "$taskRepo/tests/native/markdown-security-probe/build.rs", "$taskRepo/tests/native/markdown-security-probe/app.manifest" -Destination $taskProbe
    $taskMacaPath = (Join-Path $taskRepo 'src-tauri').Replace('\', '/')
    @"
[package]
name = "maca-markdown-security-probe"
version = "0.0.0"
edition = "2021"
publish = false

[dependencies]
maca_editor_lib = { package = "maca-editor", path = "$taskMacaPath" }
tauri = { version = "2", features = ["custom-protocol"] }

[patch.crates-io]
glib = { path = "$taskMacaPath/vendor/glib" }
wry = { path = "$taskMacaPath/vendor/wry" }
"@ | Set-Content -LiteralPath "$taskProbe/Cargo.toml" -Encoding utf8
    # Seed the disposable lock with the product versions. Cargo only needs to
    # add the wrapper package; neither production manifest nor lock is modified.
    Copy-Item -LiteralPath "$taskRepo/src-tauri/Cargo.lock" -Destination "$taskProbe/Cargo.lock"
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed' }
    $env:TAURI_CONFIG = @{ identifier = $taskIdentifier; productName = 'MaCa Markdown Security Probe' } | ConvertTo-Json -Compress
    $env:CARGO_TARGET_DIR = [IO.Path]::GetFullPath($CargoTargetDir)
    $taskCargoArgs = @('build', '--manifest-path', "$taskProbe/Cargo.toml")
    if ($Offline) { $taskCargoArgs += '--offline' }
    cargo @taskCargoArgs
    if ($LASTEXITCODE -ne 0) { throw 'Native probe build failed' }
    # Preserve this run's binary even if a later run rebuilds the shared target.
    $taskExecutable = Join-Path $taskOutput 'maca-markdown-security-probe.exe'
    Copy-Item -LiteralPath "$env:CARGO_TARGET_DIR/debug/maca-markdown-security-probe.exe" -Destination $taskExecutable
    $env:MACA_NATIVE_TEST_ID = $taskIdentifier
    $env:MACA_NATIVE_TEST_EXE = $taskExecutable
    $env:MACA_NATIVE_TEST_OUTPUT = $taskOutput
    node tests/native/markdown-security.mjs
    if ($LASTEXITCODE -ne 0) { throw "Native checks failed; diagnostics: $taskOutput" }
    Write-Host "Native security checks passed. Evidence: $taskOutput"
} finally {
    foreach ($taskName in $taskEnvironmentNames) {
        [Environment]::SetEnvironmentVariable($taskName, $taskPreviousEnvironment[$taskName], 'Process')
    }
    Pop-Location
}
