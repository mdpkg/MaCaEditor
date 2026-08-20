$paths = @(
  'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
  'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
  "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe",
  'C:\Program Files\Google\Chrome\Application\chrome.exe',
  'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe'
)
foreach ($p in $paths) {
  if (Test-Path $p) { Write-Output $p }
}
