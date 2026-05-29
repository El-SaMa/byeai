$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$extDir = Join-Path $root "extension"
$distDir = Join-Path $root "dist"
$zipPath = Join-Path $distDir "byeai-chrome.zip"

if (-not (Test-Path $extDir)) {
  throw "Extension folder not found: $extDir"
}

New-Item -ItemType Directory -Force -Path $distDir | Out-Null

if (Test-Path $zipPath) {
  Remove-Item $zipPath -Force
}

$excludeDirs = @('_metadata')
$exclude = @('*.map', '.DS_Store', 'Thumbs.db')

if (Test-Path (Join-Path $extDir '_metadata')) {
  Remove-Item (Join-Path $extDir '_metadata') -Recurse -Force
}

Compress-Archive -Path (Join-Path $extDir '*') -DestinationPath $zipPath -Force

Write-Host "Created store package: $zipPath"
Write-Host "Upload this ZIP to the Chrome Web Store Developer Dashboard."
