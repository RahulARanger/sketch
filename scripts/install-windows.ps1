$ErrorActionPreference = "Stop"

$bundleDirectory = Join-Path $PSScriptRoot "..\src-tauri\target\release\bundle\nsis"
$installer = Get-ChildItem -Path $bundleDirectory -Filter "*-setup.exe" -File |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if ($null -eq $installer) {
  throw "Build completed, but no NSIS installer was found in: $bundleDirectory"
}

Write-Host "Launching BoSketchObs installer: $($installer.FullName)"
Start-Process -FilePath $installer.FullName -Wait
